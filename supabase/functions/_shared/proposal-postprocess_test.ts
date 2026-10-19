import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import {
  ASSISTANCE_NAME_PREFIX,
  isGeneralService,
  isTravelAssistance,
  mergeDuplicateDays,
  postProcessExtraction,
  TRAVEL_ASSISTANCE
} from './proposal-postprocess.ts';
import { PRIVACY_NOTICE } from './proposal-sanitize.ts';
import { runCoherenceChecks } from './proposal-checks.ts';
import { computeDiff, incomingServiceFields } from './proposal-diff.ts';
import { ExtractionSchema } from './proposal-extraction.ts';
import { extraction, flight, proposalSnapshot, service } from './test-fixtures.ts';
import {
  FAKE_BIRTHDATE,
  FAKE_BOOKING,
  FAKE_CARD,
  FAKE_PASSPORT,
  FAKE_PASSPORT_2,
  FAKE_PHONE,
  FAKE_TICKET,
  rawThirteenDayExtraction,
  rawVoucherExtraction
} from './test-fixtures-voucher.ts';

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
    'Asistencia al viajero · Plan Viaje Seguro Plus', // nombre descriptivo; sigue en el día (el mapeo lo saca)
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
  const insurance = clean.days[0].services.find((s) => s.name === 'Asistencia al viajero · Plan Viaje Seguro Plus')!;
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

// ---------------------------------------------------------------- aviso de privacidad y servicios generales

const MARKER = 'Datos personales del documento';
const TYPE_WORDS = ['pasaporte', 'nacimiento', 'boleto', 'localizador', 'asiento', 'tarjeta', 'documento de identidad'];

Deno.test('privacidad: si el modelo omitió datos personales y lo señala en `missing`, hay UN aviso genérico y la entrada desaparece', () => {
  const data = extraction({
    travelers: { adults: 2, children: 0, children_ages: [] },
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'activity', name: 'Paseo' })] }],
    missing: ['Datos de contacto del cliente.', MARKER]
  });
  const { extraction: clean, warnings } = postProcessExtraction(data);
  assertFalse(clean.missing.some((m) => m.includes('personales')));
  assertEquals(clean.missing.includes('Datos de contacto del cliente.'), true);
  const notices = warnings.filter((w) => w.code === 'sensitive_data_removed');
  assertEquals(notices.length, 1);
  assertEquals(notices[0].message, 'Algunos datos personales del documento no se incorporan a la propuesta.');
});

Deno.test('privacidad: varias coincidencias sensibles (distintas reglas y campos) + la señal del modelo siguen siendo UN solo aviso', () => {
  const data = rawThirteenDayExtraction();
  data.missing = [MARKER, 'Fecha de nacimiento de los pasajeros.', 'No se especifican edades de los viajeros.'];
  data.days[0].services[0].description = `Pasaporte ${FAKE_PASSPORT} y boleto ${FAKE_TICKET}. Localizador ${FAKE_BOOKING}. Nacimiento: ${FAKE_BIRTHDATE}. Asiento 12A.`;
  data.notes.push(`Tarjeta ${FAKE_CARD}`);
  const { extraction: clean, warnings } = postProcessExtraction(data);
  const notices = warnings.filter((w) => w.code === 'sensitive_data_removed');
  assertEquals(notices.length, 1);
  const text = notices[0].message.toLowerCase();
  for (const word of TYPE_WORDS) {
    assertFalse(text.includes(word), `el aviso no debe mencionar «${word}»`);
  }
  assertFalse(JSON.stringify(clean).includes(FAKE_TICKET));
  assertFalse(clean.missing.some((m) => /nacimiento|personales|edades/i.test(m)));
});

Deno.test('privacidad: sin señal del modelo ni datos filtrados no hay aviso (no se inventa)', () => {
  const data = rawThirteenDayExtraction();
  data.missing = ['Datos de contacto del cliente.'];
  data.days = data.days.map((d) => ({ ...d, services: d.services.filter((s) => s.type !== 'other') }));
  data.notes = ['El clima es variable.'];
  assertEquals(postProcessExtraction(data).warnings.filter((w) => w.code === 'sensitive_data_removed'), []);
});

Deno.test('servicio general: la asistencia al viajero (por nombre o por descripción) es general; un servicio de un día, no', () => {
  const { extraction: clean } = postProcessExtraction(rawThirteenDayExtraction());
  const all = clean.days.flatMap((d) => d.services);
  assertEquals(all.filter(isGeneralService).map((s) => s.name), ['Asistencia al viajero · Titanium Plus']);
  assertFalse(isGeneralService(service({ type: 'other', name: 'Asistencia en el aeropuerto' })));
  assertFalse(isGeneralService(service({ type: 'activity', name: 'Seguro de viaje' }))); // solo `other`
  // Detectada solo por la descripción: el posprocesado le da nombre descriptivo y, por eso, también es general.
  const viaDescription = postProcessExtraction(
    extraction({
      days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'other', name: 'Plan Oro', description: 'Asistencia al viajero con cobertura.' })] }]
    })
  ).extraction.days[0].services[0];
  assertEquals(viaDescription.name, 'Asistencia al viajero · Plan Oro');
  assert(isGeneralService(viaDescription));
});

Deno.test('servicio general: la vista previa del admin usa EXACTAMENTE la misma expresión (no se desfasan)', () => {
  const client = Deno.readTextFileSync(
    new URL('../../../projects/admin/src/app/features/proposals/proposal-import/proposal-import-preview.ts', import.meta.url)
  );
  assert(client.includes(TRAVEL_ASSISTANCE.source), 'la expresión del cliente difiere de la del servidor');
});

// ---------------------------------------------------------------- missing, clasificación y asistencia (viaje de 13 días)

const byName = (data: ReturnType<typeof rawThirteenDayExtraction>, fragment: string) =>
  data.days.flatMap((d) => d.services).find((s) => s.name.includes(fragment))!;

Deno.test('13 días: el fixture es una extracción válida para el schema', () => {
  assert(ExtractionSchema.safeParse(rawThirteenDayExtraction()).success);
});

Deno.test('missing: «no se especifican edades» y «fecha de nacimiento» (datos descartados por privacidad) no son datos faltantes', () => {
  const { extraction: clean, warnings } = postProcessExtraction(rawThirteenDayExtraction());
  const text = clean.missing.join(' | ').toLowerCase();
  assertFalse(text.includes('edades'));
  assertFalse(text.includes('nacimiento'));
  // Se avisa una sola vez y en genérico: algo personal no se incorpora.
  const notices = warnings.filter((w) => w.code === 'sensitive_data_removed');
  assertEquals(notices.length, 1);
  assertEquals(notices[0].message, PRIVACY_NOTICE);
});

Deno.test('missing: un dato que de verdad no está en el PDF sí se conserva', () => {
  const { extraction: clean } = postProcessExtraction(rawThirteenDayExtraction());
  assert(clean.missing.includes('Datos de contacto del cliente (correo y teléfono).'));
  // …y el precio ausente se sigue anotando.
  assert(clean.missing.some((m) => /precio/i.test(m)));
});

Deno.test('missing: las edades de los NIÑOS sí faltan si hay niños y el PDF no las trae', () => {
  const data = rawThirteenDayExtraction();
  data.travelers = { adults: 2, children: 1, children_ages: [] };
  data.missing = ['No se especifican las edades de los niños.'];
  assertEquals(postProcessExtraction(data).extraction.missing.includes('No se especifican las edades de los niños.'), true);
});

Deno.test('clasificación: una cena show de tango tipada como comida queda como actividad (sin subtype)', () => {
  const { extraction: clean } = postProcessExtraction(rawThirteenDayExtraction());
  const tango = byName(clean, 'tango');
  assertEquals([tango.type, tango.subtype], ['activity', null]);
  assertEquals([tango.time, tango.modality], ['19:30', 'shared']);
  assertEquals(tango.activity?.included, 'Cena con entrada, plato principal, postre, vino y agua');
});

Deno.test('clasificación: una comida de verdad (restaurante, sin experiencia) sigue siendo comida', () => {
  const data = extraction({
    days: [
      {
        number: 1, date: null, base_city: null, title: null, summary: null,
        services: [service({ type: 'activity', subtype: 'meal', name: 'Almuerzo en restaurante del puerto', description: 'Menú de tres tiempos.' })]
      }
    ]
  });
  assertEquals(postProcessExtraction(data).extraction.days[0].services[0].subtype, 'meal');
});

Deno.test('asistencia: se reconoce por semántica y no depende del nombre de un plan concreto', () => {
  assert(isTravelAssistance(service({ type: 'other', name: 'Plan Cualquiera', description: 'Asistencia al viajero con cobertura médica.' })));
  assert(isTravelAssistance(service({ type: 'other', name: 'Seguro de viaje Global' })));
  assertFalse(isTravelAssistance(service({ type: 'other', name: 'Cena de gala', description: 'Con baile.' })));
  assertFalse(isTravelAssistance(service({ type: 'activity', name: 'Asistencia al viajero' }))); // solo `other`
});

Deno.test('asistencia: nombre descriptivo «Asistencia al viajero · Plan», tipo other, y los montos de cobertura no se vuelven precio', () => {
  const { extraction: clean, warnings } = postProcessExtraction(rawThirteenDayExtraction());
  const plan = byName(clean, 'Titanium Plus');
  assertEquals(plan.type, 'other');
  assertEquals(plan.name, `${ASSISTANCE_NAME_PREFIX} · Titanium Plus`);
  assertEquals(plan.price, null); // el monto de cobertura no es el precio del servicio
  assertEquals(clean.pricing, null); // ni líneas de precio: 150.000, 15.000 y 2.000 son límites del plan
  assert(warnings.some((w) => w.code === 'pricing_lines_dropped'));
  assert(clean.missing.some((m) => /precio/i.test(m))); // se mantiene «no hay precios del viaje»
});

Deno.test('asistencia: un nombre que ya la describe no se duplica', () => {
  const data = extraction({
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'other', name: 'Seguro de viaje Plus' })] }]
  });
  assertEquals(postProcessExtraction(data).extraction.days[0].services[0].name, 'Seguro de viaje Plus');
});

Deno.test('asistencia: un precio REAL del viaje en una sección de tarifas no se descarta', () => {
  const data = rawThirteenDayExtraction();
  data.pricing = {
    currency: 'USD',
    total: 4200,
    other_currencies: [],
    lines: [{ concept: 'Paquete completo', detail: null, amount: 4200, quantity: 1, unit_price: 4200, per_person: false, kind: 'service' }]
  };
  const { extraction: clean } = postProcessExtraction(data);
  assertEquals(clean.pricing?.lines.map((l) => l.concept), ['Paquete completo']);
});

Deno.test('seguridad: ni el pasaporte ni su número sobreviven en ningún texto del viaje de 13 días', () => {
  const { extraction: clean } = postProcessExtraction(rawThirteenDayExtraction());
  assertFalse(JSON.stringify(clean).includes(FAKE_PASSPORT_2));
  // El consejo general «lleve su pasaporte» SÍ se conserva (sin el número).
  assert(clean.notes.some((n) => /lleve su pasaporte/i.test(n)));
});
