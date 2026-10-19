import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { ExtractionSchema, extractionToolInputSchema, formatValidationIssues, hasUsefulContent } from './proposal-extraction.ts';
import { extraction, matchingExtraction } from './test-fixtures.ts';
import { renderTypes } from './generate-extraction-types.ts';

Deno.test('schema: el input_schema va todo en línea (sin $ref/$defs)', () => {
  const schema = extractionToolInputSchema();
  const text = JSON.stringify(schema);
  assertFalse(text.includes('$ref'));
  assertFalse(text.includes('$defs'));
  assertEquals(schema.type, 'object');
  assertEquals(Object.keys(schema.properties).sort(), [
    'client', 'days', 'exclusions', 'inclusions', 'missing', 'notes', 'pricing', 'travelers', 'trip'
  ]);
});

Deno.test('schema: los tipos de servicio son los del modelo y source_page es número', () => {
  const schema = extractionToolInputSchema();
  const service = schema.properties.days.items.properties.services.items;
  assertEquals(service.properties.type.enum, ['flight', 'hotel', 'transfer', 'activity', 'other']);
  assertEquals(service.properties.subtype.anyOf.map((s: { enum?: string[]; type?: string }) => s.enum ?? s.type), [['meal', 'train'], 'null']);
  assert(JSON.stringify(service.properties.source_page).includes('"integer"'));
  const pricingObject = schema.properties.pricing.anyOf.find((s: { type?: string }) => s.type === 'object');
  const line = pricingObject.properties.lines.items.properties;
  assertEquals(line.kind.enum, ['service', 'fee']);
  assert('quantity' in line && 'unit_price' in line);
});

Deno.test('schema: acepta una extracción válida y rechaza formatos incorrectos', () => {
  assert(ExtractionSchema.safeParse(matchingExtraction()).success);

  const badDate = matchingExtraction();
  badDate.trip.start_date = '10/03/2027';
  assertFalse(ExtractionSchema.safeParse(badDate).success);

  const impossibleDate = matchingExtraction();
  impossibleDate.trip.start_date = '2027-02-30';
  assertFalse(ExtractionSchema.safeParse(impossibleDate).success);

  const badTime = matchingExtraction();
  badTime.days[0].services[0].time = '9:30 AM';
  assertFalse(ExtractionSchema.safeParse(badTime).success);

  const badCurrency = matchingExtraction();
  badCurrency.pricing!.currency = 'usd';
  assertFalse(ExtractionSchema.safeParse(badCurrency).success);

  const badType = JSON.parse(JSON.stringify(matchingExtraction()));
  badType.days[0].services[0].type = 'comida';
  assertFalse(ExtractionSchema.safeParse(badType).success);
});

Deno.test('schema: los mensajes de error no incluyen valores del documento', () => {
  const data = JSON.parse(JSON.stringify(matchingExtraction()));
  data.client.name = 12345;
  data.trip.start_date = 'SECRETO-DEL-CLIENTE';
  const result = ExtractionSchema.safeParse(data);
  assertFalse(result.success);
  const messages = formatValidationIssues(result.error!).join('\n');
  assertFalse(messages.includes('SECRETO-DEL-CLIENTE'));
  assert(messages.includes('trip.start_date'));
});

Deno.test('hasUsefulContent: una extracción vacía no sirve', () => {
  assertFalse(hasUsefulContent(extraction()));
  assert(hasUsefulContent(matchingExtraction()));
});

Deno.test('tipos de Angular: el archivo generado está al día', async () => {
  const diffSource = await Deno.readTextFile(new URL('./proposal-diff.ts', import.meta.url));
  const generated = renderTypes(diffSource);
  const file = new URL('../../../projects/admin/src/app/core/models/proposal-extraction.types.ts', import.meta.url);
  const current = (await Deno.readTextFile(file)).replace(/\r\n/g, '\n');
  assertEquals(current, generated, 'Regenera con: deno run -A supabase/functions/_shared/generate-extraction-types.ts');
});

Deno.test('schema: campos nuevos (modality, notes, arrival_date) y pricing opcional', () => {
  const schema = extractionToolInputSchema();
  const service = schema.properties.days.items.properties.services.items;
  assertEquals(service.properties.modality.anyOf.map((s: { enum?: string[]; type?: string }) => s.enum ?? s.type), [['private', 'shared'], 'null']);
  assert('notes' in service.properties);
  assert('arrival_date' in service.properties.flight.anyOf.find((s: { type?: string }) => s.type === 'object').properties);
  assertEquals(schema.properties.pricing.anyOf.map((s: { type: string }) => s.type).sort(), ['null', 'object']);
  assert(ExtractionSchema.safeParse(extraction()).success); // pricing: null es válido
  assertFalse(JSON.stringify(schema).includes('$ref'));
});
