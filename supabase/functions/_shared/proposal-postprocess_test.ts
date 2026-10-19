import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { mergeDuplicateDays, postProcessExtraction } from './proposal-postprocess.ts';
import { runCoherenceChecks } from './proposal-checks.ts';
import { computeDiff, incomingServiceFields } from './proposal-diff.ts';
import { ExtractionSchema } from './proposal-extraction.ts';
import { extraction, flight, proposalSnapshot, service } from './test-fixtures.ts';
import { FAKE_BIRTHDATE, FAKE_BOOKING, FAKE_CARD, FAKE_PASSPORT, FAKE_PHONE, FAKE_TICKET, rawVoucherExtraction } from './test-fixtures-voucher.ts';

Deno.test('voucher: el fixture inventado es una extracción válida para el schema', () => {
  assert(ExtractionSchema.safeParse(rawVoucherExtraction()).success);
});

Deno.test('voucher: el pasaporte (y los demás datos sensibles) se eliminan de todo el texto', () => {
  const { extraction: clean, warnings } = postProcessExtraction(rawVoucherExtraction());
  const text = JSON.stringify(clean);
  for (const secret of [FAKE_PASSPORT, FAKE_TICKET, FAKE_BOOKING, FAKE_BIRTHDATE, FAKE_CARD, '12A']) {
    assertFalse(text.includes(secret), `quedó ${secret}`);
  }
  assertEquals(clean.client.phone, FAKE_PHONE);
  const sensitive = warnings.find((w) => w.code === 'sensitive_data_removed')!;
  assert(sensitive);
  for (const secret of [FAKE_PASSPORT, FAKE_TICKET, FAKE_BOOKING, FAKE_BIRTHDATE, FAKE_CARD]) {
    assertFalse(sensitive.message.includes(secret));
  }
});

Deno.test('voucher: el día repartido en dos secciones queda en un solo día, sin servicios repetidos', () => {
  const { extraction: clean, warnings } = postProcessExtraction(rawVoucherExtraction());
  assertEquals(clean.days.map((d) => d.number), [1, 2, 3, 4]);
  const day1 = clean.days[0];
  assertEquals(day1.date, '2027-05-04');
  assertEquals(day1.title, 'Salida');
  assertEquals(day1.services.map((s) => s.name), [
    'Vuelo Ciudad Norte – Isla Central',
    'Plan Viaje Seguro Plus',
    'Vuelo Isla Central – Puerto Azul', // el tramo repetido aparece una sola vez
    'Hotel Faro',
    'Traslado aeropuerto – hotel'
  ]);
  assert(warnings.some((w) => w.code === 'days_merged'));
});

Deno.test('voucher: base_city es la ciudad donde se duerme (la de la sección con el último hotel)', () => {
  const { extraction: clean } = postProcessExtraction(rawVoucherExtraction());
  assertEquals(clean.days[0].base_city, 'Puerto Azul');
});

Deno.test('días: sin hotel, base_city es la última indicada; las fechas se completan', () => {
  const { days } = mergeDuplicateDays([
    { number: 2, date: null, base_city: 'Ciudad A', title: null, summary: 'Mañana libre.', services: [service({ type: 'activity', name: 'Paseo' })] },
    { number: 2, date: '2027-05-05', base_city: 'Ciudad B', title: 'Día libre', summary: 'Mañana libre.', services: [service({ type: 'activity', name: 'Paseo' })] }
  ]);
  assertEquals(days.length, 1);
  assertEquals(days[0].base_city, 'Ciudad B');
  assertEquals(days[0].date, '2027-05-05');
  assertEquals(days[0].summary, 'Mañana libre.'); // sin repetir
  assertEquals(days[0].services.length, 1);
});

Deno.test('días: dos secciones con la misma fecha pero distinto número también se unen', () => {
  const { days, merged } = mergeDuplicateDays([
    { number: 3, date: '2027-05-06', base_city: null, title: null, summary: null, services: [] },
    { number: 4, date: '2027-05-06', base_city: null, title: null, summary: null, services: [] },
    { number: 5, date: '2027-05-07', base_city: null, title: null, summary: null, services: [] }
  ]);
  assertEquals(merged, 1);
  assertEquals(days.map((d) => d.number), [3, 5]);
});

Deno.test('voucher: los montos de coberturas de seguro, equipaje y penalidades no quedan en pricing', () => {
  const { extraction: clean, warnings } = postProcessExtraction(rawVoucherExtraction());
  assertEquals(clean.pricing?.lines.map((l) => l.concept), ['Paquete Isla Central y Puerto Azul']);
  assertEquals(clean.pricing?.total, 2000);
  const dropped = warnings.find((w) => w.code === 'pricing_lines_dropped')!;
  assert(dropped.message.includes('Cobertura de asistencia médica'));
  assertFalse(dropped.message.includes('60000')); // sin montos
});

Deno.test('precios: una línea de "Seguro de viaje" con precio explícito sí se conserva', () => {
  const data = rawVoucherExtraction();
  data.pricing!.lines.push({ concept: 'Seguro de viaje', detail: 'Plan Plus', amount: 80, quantity: 1, unit_price: 80, per_person: false, kind: 'service' });
  const { extraction: clean } = postProcessExtraction(data);
  assert(clean.pricing!.lines.some((l) => l.concept === 'Seguro de viaje'));
});

Deno.test('precios: si lo único que había eran coberturas, pricing queda en null y va a missing', () => {
  const data = rawVoucherExtraction();
  data.pricing = { currency: 'USD', total: null, other_currencies: [], lines: data.pricing!.lines.slice(0, 3) };
  const { extraction: clean } = postProcessExtraction(data);
  assertEquals(clean.pricing, null);
  assert(clean.missing.some((m) => m.startsWith('Precios:')));
});

Deno.test('precios: un PDF sin precios deja pricing en null y lo anota en missing una sola vez', () => {
  const once = postProcessExtraction(extraction({ days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [] }] }));
  assertEquals(once.extraction.pricing, null);
  assertEquals(once.extraction.missing.filter((m) => m.startsWith('Precios:')).length, 1);
  const twice = postProcessExtraction(once.extraction);
  assertEquals(twice.extraction.missing.length, once.extraction.missing.length);
  // Si el modelo ya lo anotó con sus palabras, no se duplica.
  const own = postProcessExtraction(extraction({ missing: ['precios'] }));
  assertEquals(own.extraction.missing, ['precios']);
});

Deno.test('vuelos: un servicio por tramo, con la fecha de llegada al día siguiente', () => {
  const { extraction: clean } = postProcessExtraction(rawVoucherExtraction());
  const legs = clean.days.flatMap((d) => d.services).filter((s) => s.type === 'flight');
  assertEquals(legs.length, 2);
  const [leg1, leg2] = legs;
  assertEquals(leg1.flight?.arrival_date, '2027-05-04');
  assertEquals(leg2.flight?.departure_time, '22:30');
  assertEquals(leg2.flight?.arrival_time, '01:10');
  assertEquals(leg2.flight?.arrival_date, '2027-05-05');
  assertEquals(runCoherenceChecks(clean).filter((w) => w.code === 'flight_multiple_legs'), []);
});

Deno.test('vuelos: un servicio que agrupa varios tramos se señala', () => {
  const data = extraction({
    days: [
      {
        number: 1,
        date: null,
        base_city: null,
        title: null,
        summary: null,
        services: [flight('Vuelo ZX 101 / ZX 202 con conexión', 'ZX 101 / ZX 202')]
      }
    ]
  });
  assertEquals(runCoherenceChecks(data).map((w) => w.code), ['flight_multiple_legs']);
});

Deno.test('modalidad: traslados → transferType; el resto → details.modality', () => {
  const { extraction: clean } = postProcessExtraction(rawVoucherExtraction());
  const all = clean.days.flatMap((d) => d.services);
  const transfer = all.find((s) => s.type === 'transfer')!;
  assertEquals(incomingServiceFields(transfer).details.transferType, 'Privado · Van 8 pax');
  assertEquals(incomingServiceFields(transfer).details.modality, undefined);
  const tour = all.find((s) => s.type === 'activity')!;
  assertEquals(incomingServiceFields(tour).details.modality, 'Compartido');
  assertEquals(incomingServiceFields(tour).details.transferType, undefined);
  // Sin modalidad no se inventa una.
  const hotelService = all.find((s) => s.type === 'hotel')!;
  assertEquals(incomingServiceFields(hotelService).details.modality, null);
});

Deno.test('modalidad: un traslado actual "Van 8 pax" no se marca distinto por añadir "Privado"', () => {
  const snapshot = proposalSnapshot();
  const day = (snapshot.content as { days: { services: unknown[] }[] }).days[0];
  day.services.push({ id: 'svc-transfer', type: 'transfer', title: 'Traslado aeropuerto – hotel', time: '11:00', details: { transferType: 'Van 8 pax' } });
  const data = extraction({
    trip: { title: null, start_date: '2027-03-10', end_date: null, destinations: [] },
    days: [
      {
        number: 1,
        date: '2027-03-10',
        base_city: null,
        title: null,
        summary: null,
        services: [service({ type: 'transfer', name: 'Traslado aeropuerto – hotel', time: '11:00', modality: 'private', transfer: { from: null, to: null, vehicle_type: 'Van 8 pax', passengers: null, baggage: null } })]
      }
    ]
  });
  const item = computeDiff(data, snapshot).services[0];
  assertEquals(item.status, 'unchanged');
});

Deno.test('seguro y notas: el servicio de seguro es un "other" del primer día con "No incluye" en sus notes', () => {
  const { extraction: clean } = postProcessExtraction(rawVoucherExtraction());
  const insurance = clean.days[0].services.find((s) => s.name === 'Plan Viaje Seguro Plus')!;
  assertEquals(insurance.type, 'other');
  assert(insurance.notes!.startsWith('No incluye deportes extremos'));
  assertFalse(insurance.description!.includes('Pasaporte'));
});

Deno.test('postproceso: el diff funciona con pricing en null', () => {
  const data = extraction({ trip: { title: null, start_date: '2027-03-10', end_date: null, destinations: [] } });
  const diff = computeDiff(data, proposalSnapshot());
  assertEquals(diff.pricing.lines, []);
  assertEquals(diff.pricing.currency.status, 'unchanged');
  assertEquals(diff.pricing.total.status, 'unchanged');
});

Deno.test('postproceso: hoteles del fixture conservan sus noches tras unir días', () => {
  const { extraction: clean } = postProcessExtraction(rawVoucherExtraction());
  const stay = clean.days[0].services.find((s) => s.type === 'hotel')!;
  assertEquals([stay.hotel?.check_in_date, stay.hotel?.check_out_date], ['2027-05-04', '2027-05-06']);
});
