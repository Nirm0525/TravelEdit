// Extracción rica de un PDF, de punta a punta: schema → sanitización → posprocesado → mapeo → apply.
// (La vista previa tiene su propio spec en Angular: proposal-import-preview.spec.ts.)
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { ExtractionSchema, extractionToolInputSchema } from './proposal-extraction.ts';
import { isNotTripPrice, mergeText, postProcessExtraction } from './proposal-postprocess.ts';
import { scrubText } from './proposal-sanitize.ts';
import { formatShortDate, mapExtractionToProposal } from './proposal-mapping.ts';
import { extraction, service } from './test-fixtures.ts';
import {
  RICH_SENSITIVE,
  RICH_TIPS,
  SANTIAGO_SUMMARY,
  WINERY_DESCRIPTION,
  WINERY_EXTRA,
  rawRichExtraction
} from './test-fixtures-rich.ts';
import { handleRequest, type Deps } from '../apply-proposal-import/handler.ts';
import type { MappedProposal } from './proposal-mapping.ts';
import { SYSTEM_PROMPT } from '../import-proposal-pdf/openai.ts';

const processed = () => postProcessExtraction(rawRichExtraction());
const mapped = () => mapExtractionToProposal(processed().extraction);
const allServices = (p: MappedProposal) => p.content.days.flatMap((d) => d.services);
const serviceNamed = (p: MappedProposal, fragment: string) => allServices(p).find((s) => s.title.includes(fragment))!;

// ---------------------------------------------------------------- schema y prompt

Deno.test('rico/schema: acepta descripciones largas y el resumen del día', () => {
  const parsed = ExtractionSchema.safeParse(rawRichExtraction());
  assert(parsed.success);
  const long = { ...rawRichExtraction() };
  long.days[0].summary = 'Texto descriptivo. '.repeat(200);
  assert(ExtractionSchema.safeParse(long).success);
});

Deno.test('rico/schema: no obliga a inventar (descripción y resumen pueden ser null)', () => {
  const bare = extraction({
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'activity', name: 'Paseo' })] }]
  });
  assert(ExtractionSchema.safeParse(bare).success);
  const schema = JSON.stringify(extractionToolInputSchema());
  assertStringIncludes(schema, 'sin resumir de más ni inventar');
  assertStringIncludes(schema, 'null si el PDF no lo trae');
});

Deno.test('rico/prompt: exige conservar descripciones de día y de servicio sin inventar', () => {
  for (const fragment of [
    'consérvalo en `summary` del día sin resumirlo de más',
    'consérvala en `description` del servicio',
    'No reduzcas una actividad con varios párrafos de descripción a solo su nombre.',
    'Nunca inventes texto',
    'ponlos en `description`'
  ]) {
    assertStringIncludes(SYSTEM_PROMPT, fragment);
  }
});

// ---------------------------------------------------------------- sanitización

Deno.test('rico/sanitización: los datos sensibles desaparecen y el texto genérico se conserva', () => {
  const { extraction: data } = processed();
  const json = JSON.stringify(data);
  for (const value of RICH_SENSITIVE) {
    assertFalse(json.includes(value), `no debe quedar: ${value}`);
  }
  assert(data.notes.includes(RICH_TIPS.passport), '«Lleve su pasaporte…» se conserva');
});

Deno.test('rico/sanitización: las descripciones largas no disparan falsos positivos', () => {
  for (const text of [SANTIAGO_SUMMARY, WINERY_DESCRIPTION, WINERY_EXTRA]) {
    const { text: out, removed } = scrubText(text);
    assertEquals(out, text);
    assertEquals(removed, {});
  }
});

// ---------------------------------------------------------------- posprocesado

Deno.test('rico/posprocesado: dos servicios iguales con descripciones distintas no pierden contenido', () => {
  const { extraction: data } = processed();
  const day3 = data.days.find((d) => d.number === 3)!;
  assertEquals(day3.services.length, 1);
  const description = day3.services[0].description!;
  assertStringIncludes(description, 'Guía: guía de habla hispana');
  assertStringIncludes(description, WINERY_EXTRA);
  assertEquals(description.split(WINERY_EXTRA).length, 2, 'el texto nuevo aparece una sola vez');
});

Deno.test('rico/posprocesado: mergeText no duplica, conserva el más completo y combina lo distinto', () => {
  assertEquals(mergeText(null, null), null);
  assertEquals(mergeText('A', null), 'A');
  assertEquals(mergeText(null, 'B'), 'B');
  assertEquals(mergeText('Recorrido por el valle.', ' recorrido por el valle '), 'Recorrido por el valle.');
  assertEquals(mergeText('Recorrido por el valle', 'Recorrido por el valle con almuerzo.'), 'Recorrido por el valle con almuerzo.');
  assertEquals(mergeText('Recorrido por el valle con almuerzo.', 'Recorrido por el valle'), 'Recorrido por el valle con almuerzo.');
  assertEquals(mergeText('Primero.', 'Segundo.'), 'Primero.\n\nSegundo.');
});

Deno.test('rico/posprocesado: la fusión también suma notas y datos de la ficha que faltaban', () => {
  const first = service({ type: 'activity', name: 'Cata', time: '10:00', activity: { duration: null, meeting_point: null, participants: null, included: 'Vino', language: null } });
  const second = service({
    type: 'activity',
    name: 'Cata',
    time: '10:00',
    notes: 'No incluye propinas.',
    activity: { duration: '2 horas', meeting_point: 'Lobby', participants: null, included: 'Queso', language: null }
  });
  const { extraction: data } = postProcessExtraction(
    extraction({
      days: [
        { number: 1, date: '2027-01-01', base_city: null, title: null, summary: 'Día de cata.', services: [first] },
        { number: 1, date: null, base_city: null, title: null, summary: 'Día de cata.', services: [second] }
      ]
    })
  );
  const merged = data.days[0].services[0];
  assertEquals(merged.notes, 'No incluye propinas.');
  assertEquals(merged.activity?.duration, '2 horas');
  assertEquals(merged.activity?.meeting_point, 'Lobby');
  assertEquals(merged.activity?.included, 'Vino\n\nQueso');
  assertEquals(data.days[0].summary, 'Día de cata.', 'el resumen idéntico no se duplica');
});

Deno.test('rico/precios: el equipaje adicional cobrado se conserva; la cobertura de seguro sigue fuera', () => {
  const { extraction: data, warnings } = processed();
  const concepts = data.pricing!.lines.map((l) => l.concept);
  assertEquals(concepts, ['Paquete Santiago y sus valles', 'Equipaje adicional', 'Tasa de servicio']);
  const dropped = warnings.find((w) => w.code === 'pricing_lines_dropped')!;
  assertStringIncludes(dropped.message, 'Cobertura de equipaje');
  assertStringIncludes(dropped.message, 'Cobertura de asistencia médica');
});

Deno.test('rico/precios: isNotTripPrice distingue cobertura de seguro y extra cobrado', () => {
  // Extras cobrados como servicio: SÍ son precio.
  for (const text of ['Equipaje adicional', 'Equipaje adicional — maleta de 23 kg', 'Maleta extra', 'Equipaje de bodega adicional — 23 kg', 'Equipaje adicional hasta 23 kg']) {
    assertFalse(isNotTripPrice(text), `precio real: ${text}`);
  }
  // Coberturas, beneficios del seguro y políticas: NO son precio.
  for (const text of [
    'Cobertura de equipaje',
    'Equipaje adicional por demora — hasta USD 500',
    'Reembolso por equipaje adicional',
    'Equipaje extraviado',
    'Equipaje de mano',
    'Política de equipaje',
    'Penalidad por cambio',
    'Asistencia médica'
  ]) {
    assert(isNotTripPrice(text), `no es precio: ${text}`);
  }
});

// ---------------------------------------------------------------- mapeo

Deno.test('rico/mapeo: day.summary llega a day.description', () => {
  const day2 = mapped().content.days.find((d) => d.dayNumber === 2)!;
  assertEquals(day2.description, SANTIAGO_SUMMARY);
  assertEquals(day2.location, 'Santiago de Isla Sur');
});

Deno.test('rico/mapeo: la descripción larga del servicio llega completa a ProposalContent', () => {
  const winery = serviceNamed(mapped(), 'Bodega Valle Azul');
  assertStringIncludes(winery.description, WINERY_DESCRIPTION);
  assertStringIncludes(winery.description, WINERY_EXTRA);
  assertStringIncludes(winery.description, 'Guía: guía de habla hispana');
});

Deno.test('rico/mapeo: la llegada del vuelo muestra su fecha cuando ocurre otro día', () => {
  const flight = serviceNamed(mapped(), 'Vuelo Ciudad Norte');
  assertEquals(flight.time, '23:10');
  assertEquals(flight.details.arrivalTime, '02:48 · 19 nov 2026');
  assertEquals(flight.details.arrivalDate, '2026-11-19');
  assertEquals(
    [flight.details.airline, flight.details.flightNumber, flight.details.cabin, flight.details.baggage],
    ['Aerolínea Ficticia', 'ZX 880', 'Económica', '1 maleta de 23 kg']
  );
  assertEquals(flight.details.origin, 'Ciudad Norte (CNO)');
  assertEquals(flight.details.destination, 'Santiago de Isla Sur (SIS)');
});

Deno.test('rico/mapeo: un vuelo que llega el mismo día no muestra fecha; sin arrival_date no se inventa', () => {
  const sameDay = service({
    type: 'flight',
    name: 'Vuelo corto',
    date: '2026-11-18',
    flight: { airline: null, flight_number: 'ZX 1', origin: null, destination: null, departure_time: '08:00', arrival_time: '10:00', arrival_date: '2026-11-18', cabin: null, baggage: null }
  });
  const noDate = service({
    type: 'flight',
    name: 'Vuelo sin fecha',
    flight: { airline: null, flight_number: 'ZX 2', origin: null, destination: null, departure_time: '08:00', arrival_time: '10:00', arrival_date: null, cabin: null, baggage: null }
  });
  const p = mapExtractionToProposal(
    extraction({ days: [{ number: 1, date: '2026-11-18', base_city: null, title: null, summary: null, services: [sameDay, noDate] }] })
  );
  const [a, b] = p.content.days[0].services;
  assertEquals(a.details.arrivalTime, '10:00');
  assertEquals(b.details.arrivalTime, '10:00');
  assertFalse('arrivalDate' in b.details);
});

Deno.test('rico/mapeo: el hotel conserva fechas, habitación, régimen, categoría y huéspedes', () => {
  const hotel = serviceNamed(mapped(), 'Hotel Faro');
  assertEquals(hotel.details.checkIn, '15:00 · 19 nov 2026');
  assertEquals(hotel.details.checkOut, '12:00 · 21 nov 2026');
  assertEquals([hotel.details.checkInDate, hotel.details.checkOutDate], ['2026-11-19', '2026-11-21']);
  assertEquals(hotel.details.roomType, 'Habitación Superior');
  assertEquals(hotel.details.mealPlan, 'Desayuno incluido');
  assertEquals(hotel.details.category, '5 estrellas');
  assertEquals(hotel.details.guests, '2 adultos');
  assertEquals(hotel.details.address, 'Avenida Ejemplo 100');
  assertFalse('nights' in hotel.details, 'las noches no son un campo del contrato');
});

Deno.test('rico/mapeo: el traslado conserva ruta, vehículo, modalidad, pasajeros, equipaje, duración y ubicación', () => {
  const transfer = serviceNamed(mapped(), 'Traslado aeropuerto');
  assertEquals(transfer.time, '03:30');
  assertEquals(transfer.details.transferType, 'Privado · Van privada');
  assertEquals([transfer.details.pickupLocation, transfer.details.dropoffLocation], ['Aeropuerto de Santiago de Isla Sur', 'Hotel Faro Santiago']);
  assertEquals([transfer.details.passengers, transfer.details.baggage], ['2', '2 maletas']);
  assertStringIncludes(transfer.description, 'Duración aproximada: 40 minutos.');
  // La ubicación no tiene campo visible en traslados: va a la descripción porque aporta algo.
  assertStringIncludes(transfer.description, 'Ubicación: Terminal internacional, puerta B');
});

Deno.test('rico/mapeo: la ubicación de un vuelo que repite origen/destino o la descripción no se duplica', () => {
  const dup = service({
    type: 'flight',
    name: 'Vuelo',
    location: 'Terminal 2',
    description: 'Sale de la Terminal 2.',
    flight: { airline: null, flight_number: 'ZX 3', origin: 'Ciudad Norte', destination: null, departure_time: null, arrival_time: null, arrival_date: null, cabin: null, baggage: null }
  });
  const sameAsOrigin = service({
    type: 'flight',
    name: 'Vuelo 2',
    location: 'Ciudad Norte',
    flight: { airline: null, flight_number: 'ZX 4', origin: 'Ciudad Norte', destination: null, departure_time: null, arrival_time: null, arrival_date: null, cabin: null, baggage: null }
  });
  const p = mapExtractionToProposal(extraction({ days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [dup, sameAsOrigin] }] }));
  assertEquals(p.content.days[0].services[0].description, 'Sale de la Terminal 2.');
  assertEquals(p.content.days[0].services[1].description, '');
  // El vuelo del fixture rico sí aporta una ubicación nueva.
  assertStringIncludes(serviceNamed(mapped(), 'Vuelo Ciudad Norte').description, 'Ubicación: Terminal 2');
});

Deno.test('rico/mapeo: la actividad conserva duración, punto de encuentro, participantes, incluye, idioma, notas y modalidad', () => {
  const winery = serviceNamed(mapped(), 'Bodega Valle Azul');
  assertEquals(winery.time, '09:30');
  assertEquals(winery.details.duration, '5 horas');
  assertEquals(winery.details.meetingPoint, 'Lobby del hotel');
  assertEquals(winery.details.participants, '2 personas');
  assertEquals(winery.details.included, 'Degustación de 3 vinos y almuerzo');
  assertEquals(winery.details.language, 'Español');
  assertEquals(winery.notes, 'No incluye propinas.');
  assertStringIncludes(winery.description, 'Modalidad: Compartido');
});

Deno.test('rico/mapeo: la modalidad no se repite si la descripción ya la dice', () => {
  const tour = service({ type: 'activity', name: 'Tour', modality: 'private', description: 'Tour privado por la ciudad.' });
  const p = mapExtractionToProposal(extraction({ days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [tour] }] }));
  assertEquals(p.content.days[0].services[0].description, 'Tour privado por la ciudad.');
});

Deno.test('rico/mapeo: Travel Tips por ciudad y con categorías del contrato', () => {
  const tips = mapped().content.travelTips;
  assertEquals(tips.map((g) => g.destination), ['General', 'Santiago de Isla Sur']);
  const general = tips[0].tips;
  assertEquals(general.map((t) => [t.body, t.category]), [
    [RICH_TIPS.passport, 'other'],
    [RICH_TIPS.weather, 'weather']
  ]);
  const santiago = tips[1].tips;
  assertEquals(santiago.map((t) => [t.body, t.category, t.title]), [[RICH_TIPS.airport, 'transport', 'Transporte']]);
  const allowed = ['', 'restaurants', 'transport', 'weather', 'customs', 'safety', 'payments', 'other'];
  for (const tip of tips.flatMap((g) => g.tips)) {
    assert(allowed.includes(tip.category), `categoría fuera del contrato: ${tip.category}`);
  }
});

Deno.test('rico/mapeo: precios reales (con el extra de equipaje) y sin coberturas', () => {
  const { pricing } = mapped().content;
  assertEquals(pricing.lines.map((l) => [l.label, l.quantity, l.unitPrice]), [
    ['Paquete Santiago y sus valles', 1, 3200],
    ['Equipaje adicional — maleta de 23 kg por persona', 2, 60]
  ]);
  assertEquals(pricing.feesLines.map((l) => [l.label, l.quantity, l.unitPrice]), [['Tasa de servicio', 1, 50]]);
  assertEquals(mapped().currency, 'USD');
});

Deno.test('rico/mapeo: lo que solo cabe en la vista previa sigue fuera del contenido (inclusiones, exclusiones, seguro)', () => {
  const json = JSON.stringify(mapped().content);
  assertFalse(json.includes('Vuelos internacionales'));
  assertFalse(json.includes('Desayunos diarios'));
  assertFalse(json.includes('Plan Viaje Seguro Plus'));
  assertEquals(mapped().content.welcome.body, '');
  assertEquals(mapped().content.intro.body, '');
});

Deno.test('rico/mapeo: ningún dato sensible llega al contenido', () => {
  const json = JSON.stringify(mapped());
  for (const value of RICH_SENSITIVE) {
    assertFalse(json.includes(value), `no debe llegar: ${value}`);
  }
  assertStringIncludes(json, RICH_TIPS.passport);
});

Deno.test('rico/mapeo: formatShortDate', () => {
  assertEquals(formatShortDate('2026-11-19'), '19 nov 2026');
  assertEquals(formatShortDate('2026-01-05'), '5 ene 2026');
  assertEquals(formatShortDate(null), null);
  assertEquals(formatShortDate('19/11/2026'), null);
  assertEquals(formatShortDate('2026-13-01'), null);
});

// ---------------------------------------------------------------- apply

const USER = '11111111-1111-1111-1111-111111111111';
const IMPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

Deno.test('rico/apply: la propuesta insertada conserva toda la información rica y ninguna sensible', async () => {
  let inserted: MappedProposal | null = null;
  const deps: Deps = {
    env: () => undefined,
    getUser: () => Promise.resolve({ id: USER }),
    getImportAsUser: () =>
      Promise.resolve({
        id: IMPORT_ID,
        mode: 'new',
        status: 'ready',
        file_path: `${USER}/x.pdf`,
        created_by: USER,
        extracted: { ...processed().extraction, warnings: [], meta: { model: 'gpt-6-luna', extracted_at: '2027-01-01T00:00:00Z' } }
      }),
    canManageProposals: () => Promise.resolve(true),
    canSeeLead: () => Promise.resolve(true),
    applyImport: (args) => {
      inserted = args.mapped;
      return Promise.resolve('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
    },
    deleteFile: () => Promise.resolve(),
    log: () => {}
  };
  const res = await handleRequest(
    new Request('https://x.test/functions/v1/apply-proposal-import', {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: 'Bearer good' },
      body: JSON.stringify({ import_id: IMPORT_ID, origin_channel: 'web' })
    }),
    deps
  );
  assertEquals(res.status, 200);
  const p = inserted as MappedProposal | null;
  assert(p);
  // Es exactamente lo que tx.ts serializa a proposals.content.
  const content = JSON.parse(JSON.stringify(p.content));
  const services = content.days.flatMap((d: { services: { title: string; description: string; details: Record<string, string> }[] }) => d.services);
  assertEquals(content.days.find((d: { dayNumber: number }) => d.dayNumber === 2).description, SANTIAGO_SUMMARY);
  assertStringIncludes(services.find((s: { title: string }) => s.title === 'Bodega Valle Azul').description, WINERY_DESCRIPTION);
  assertEquals(services.find((s: { title: string }) => s.title.startsWith('Vuelo')).details.arrivalTime, '02:48 · 19 nov 2026');
  assertEquals(services.find((s: { title: string }) => s.title === 'Hotel Faro Santiago').details.checkIn, '15:00 · 19 nov 2026');
  assertEquals(content.travelTips.length, 2);
  assertEquals(content.pricing.lines.length, 2);
  const json = JSON.stringify(content);
  for (const value of RICH_SENSITIVE) {
    assertFalse(json.includes(value));
  }
});
