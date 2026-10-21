import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { isTravelKind, sanitizeExtractionForKind, warningsForKind } from './travel-kind.ts';
import { mapExtractionToProposal } from './proposal-mapping.ts';
import { matchingExtraction } from './test-fixtures.ts';
import type { Extraction } from './proposal-extraction.ts';

/** Una extracción con TODO lo comercial/contractual que un PDF de cotización puede traer. */
function contractual(): Extraction {
  const base = matchingExtraction();
  return {
    ...base,
    inclusions: ['Todo incluido', 'Traslados privados'],
    exclusions: ['Propinas', 'Vuelos internacionales'],
    notes: ['Lleva abrigo: hace frío por la noche.'],
    missing: ['Precio por persona no encontrado', 'Términos y condiciones', 'Teléfono del cliente'],
    days: base.days.map((day) => ({ ...day, services: day.services.map((s) => ({ ...s, price: { amount: 100, per_person: false } })) }))
  };
}

Deno.test('isTravelKind: solo proposal e itinerary', () => {
  assert(isTravelKind('proposal') && isTravelKind('itinerary'));
  for (const v of ['trip', '', null, undefined, 1, 'PROPOSAL']) {
    assertFalse(isTravelKind(v));
  }
});

Deno.test('sanitize proposal: no cambia NADA (misma extracción)', () => {
  const e = contractual();
  assert(sanitizeExtractionForKind(e, 'proposal') === e);
});

Deno.test('sanitize itinerary: descarta pricing, price de cada servicio, inclusiones y exclusiones', () => {
  const e = contractual();
  assert(e.pricing !== null && e.pricing.lines.length > 0);
  const clean = sanitizeExtractionForKind(e, 'itinerary');
  assertEquals(clean.pricing, null);
  assertEquals([clean.inclusions, clean.exclusions], [[], []]);
  for (const day of clean.days) {
    for (const service of day.services) {
      assertEquals(service.price, null);
    }
  }
  // No muta la entrada.
  assert(e.pricing !== null);
  assert(e.days[0].services.every((s) => s.price !== null));
});

Deno.test('sanitize itinerary: conserva lo operativo (cliente, viaje, viajeros, días, servicios, notas)', () => {
  const e = contractual();
  const clean = sanitizeExtractionForKind(e, 'itinerary');
  assertEquals(clean.client, e.client);
  assertEquals(clean.trip, e.trip);
  assertEquals(clean.travelers, e.travelers);
  assertEquals(clean.notes, e.notes);
  assertEquals(clean.days.length, e.days.length);
  assertEquals(
    clean.days.map((d) => d.services.map((s) => s.name)),
    e.days.map((d) => d.services.map((s) => s.name))
  );
});

Deno.test('sanitize itinerary: quita de `missing` lo comercial pero conserva lo que de verdad falta', () => {
  const clean = sanitizeExtractionForKind(contractual(), 'itinerary');
  assertEquals(clean.missing, ['Teléfono del cliente']);
});

Deno.test('warningsForKind: un itinerario no ve avisos de precios; una propuesta los ve todos', () => {
  const warnings = [
    { code: 'days_merged', message: 'a' },
    { code: 'price_total_mismatch', message: 'b' },
    { code: 'pricing_lines_dropped', message: 'c' },
    { code: 'multiple_currencies', message: 'd' },
    { code: 'dates_outside_trip', message: 'e' }
  ];
  assertEquals(warningsForKind(warnings, 'itinerary').map((w) => w.code), ['days_merged', 'dates_outside_trip']);
  assertEquals(warningsForKind(warnings, 'proposal').length, 5);
});

Deno.test('mapeo itinerary: sin líneas de precio, sin moneda y sin términos, aunque la extracción los traiga', () => {
  const mapped = mapExtractionToProposal(contractual(), undefined, 'itinerary');
  assertEquals(mapped.currency, null);
  assertEquals(mapped.content.pricing, { lines: [], feesLines: [] });
  assertEquals(mapped.content.terms, { title: '', body: '' });
  assertEquals(mapped.content.welcome.body, '');
  assert(mapped.content.days.length > 0);
  assert(JSON.stringify(mapped.content).toLowerCase().includes('todo incluido') === false, 'las inclusiones generales no se cuelan en el contenido');
});

Deno.test('mapeo itinerary: conserva portada, días, servicios y Travel Tips', () => {
  const mapped = mapExtractionToProposal(contractual(), undefined, 'itinerary');
  assertEquals(mapped.content.cover.title, matchingExtraction().trip.title ?? '');
  assert(mapped.content.days.some((d) => d.services.length > 0));
  assertEquals(mapped.content.travelTips.flatMap((g) => g.tips.map((t) => t.body)), ['Lleva abrigo: hace frío por la noche.']);
  assertEquals(mapped.clientName, matchingExtraction().client.name?.trim() ?? '');
});

Deno.test('mapeo proposal (por defecto y explícito): sigue mapeando precios, moneda y términos de partida', () => {
  for (const mapped of [mapExtractionToProposal(contractual()), mapExtractionToProposal(contractual(), undefined, 'proposal')]) {
    assert(mapped.content.pricing.lines.length > 0);
    assert(typeof mapped.currency === 'string' && mapped.currency.length === 3);
    assertEquals(mapped.content.terms.title, 'Términos y condiciones');
  }
});

Deno.test('mapeo itinerary: el JSON de contenido no contiene ninguna clave comercial con datos (pricing/terms vacíos)', () => {
  const content = mapExtractionToProposal(contractual(), undefined, 'itinerary').content as unknown as Record<string, any>;
  assertEquals(content.pricing.lines.length + content.pricing.feesLines.length, 0);
  assertEquals(content.terms.body + content.terms.title, '');
  for (const day of content.days) {
    for (const service of day.services) {
      assertFalse('price' in service, 'el servicio mapeado no lleva price');
    }
  }
});
