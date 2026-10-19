import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import { mapExtractionToProposal } from './proposal-mapping.ts';
import { postProcessExtraction } from './proposal-postprocess.ts';
import { extraction, service } from './test-fixtures.ts';
import { FAKE_BIRTHDATE, FAKE_BOOKING, FAKE_CARD, FAKE_PASSPORT, FAKE_TICKET, rawVoucherExtraction } from './test-fixtures-voucher.ts';

const voucher = () => mapExtractionToProposal(postProcessExtraction(rawVoucherExtraction()).extraction);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

Deno.test('mapeo: datos de la propuesta', () => {
  const p = voucher();
  assertEquals(p.clientName, 'Persona Ejemplo');
  assertEquals(p.clientEmail, 'persona@ejemplo.test');
  assertEquals(p.clientPhone, '+5491155550000');
  assertEquals(p.destinationText, 'Isla Central, Puerto Azul');
  assertEquals([p.startDate, p.endDate], ['2027-05-04', '2027-05-07']);
  assertEquals(p.travelersCount, 2);
  assertEquals(p.currency, 'USD');
  assertEquals(p.content.cover.title, 'Viaje de prueba');
});

Deno.test('mapeo: días con número, título (o ciudad base), ubicación y resumen', () => {
  const { days } = voucher().content;
  assertEquals(days.map((d) => d.dayNumber), [1, 2, 3, 4]);
  assertEquals(days[0].title, 'Salida');
  assertEquals(days[0].location, 'Puerto Azul'); // ciudad donde se duerme
  assertEquals(days[1].title, 'Puerto Azul'); // sin título en el PDF → ciudad base
  assert(days.every((d) => d.imagePath === null));
  assertEquals(days[0].services.length, 5); // el día repartido en dos secciones quedó unido
});

Deno.test('mapeo: servicios con ficha por tipo, modalidad y subtype', () => {
  const services = voucher().content.days[0].services;
  const [leg1, insurance, leg2, hotel, transfer] = services;

  assertEquals(leg1.type, 'flight');
  assertEquals(leg1.time, '08:00'); // salida
  assertEquals(leg1.details.flightNumber, 'ZX 101');
  assertEquals(leg1.details.arrivalTime, '10:30');
  assertEquals(leg1.details.arrivalDate, '2027-05-04');

  assertEquals(leg2.time, '22:30');
  assertEquals([leg2.details.arrivalTime, leg2.details.arrivalDate], ['01:10', '2027-05-05']); // llega al día siguiente

  assertEquals(insurance.type, 'other');
  assert(insurance.notes.startsWith('No incluye deportes extremos'));

  assertEquals(hotel.type, 'hotel');
  assertEquals([hotel.details.checkInDate, hotel.details.checkOutDate], ['2027-05-04', '2027-05-06']);
  assertEquals(hotel.details.roomType, 'Doble');

  assertEquals(transfer.type, 'transfer');
  assertEquals(transfer.details.transferType, 'Privado · Van 8 pax'); // modalidad de un traslado
  assertEquals(transfer.details.pickupLocation, 'Aeropuerto de Puerto Azul');
  assertEquals(transfer.details.modality, undefined);

  const tour = voucher().content.days[1].services[0];
  assertEquals(tour.details.modality, 'Compartido'); // modalidad de los demás tipos
  assert(services.every((s) => s.imagePath === null && UUID.test(s.id)));
});

Deno.test('mapeo: comida y tren conservan el subtype', () => {
  const data = extraction({
    days: [
      {
        number: 1,
        date: null,
        base_city: null,
        title: null,
        summary: null,
        services: [service({ type: 'activity', name: 'Cena', subtype: 'meal' }), service({ type: 'transfer', name: 'Tren', subtype: 'train' }), service({ type: 'activity', name: 'Paseo' })]
      }
    ]
  });
  const [meal, train, walk] = mapExtractionToProposal(data).content.days[0].services;
  assertEquals([meal.subtype, train.subtype, walk.subtype], ['meal', 'train', undefined]);
  assertFalse('subtype' in walk);
});

Deno.test('mapeo: la ubicación se aprovecha en hoteles y actividades que no traen dirección/punto de encuentro', () => {
  const data = extraction({
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'hotel', name: 'H', location: 'Calle Falsa 123' }), service({ type: 'activity', name: 'A', location: 'Muelle 4' })] }]
  });
  const [hotel, activity] = mapExtractionToProposal(data).content.days[0].services;
  assertEquals(hotel.details.address, 'Calle Falsa 123');
  assertEquals(activity.details.meetingPoint, 'Muelle 4');
});

Deno.test('mapeo: precios — línea principal sin duplicar y los datos sensibles/coberturas no llegan', () => {
  const { lines, feesLines } = voucher().content.pricing;
  assertEquals(lines.map((l) => [l.label, l.quantity, l.unitPrice]), [['Paquete Isla Central y Puerto Azul', 1, 2000]]);
  assertEquals(feesLines, []);
  const text = JSON.stringify(voucher());
  for (const secret of [FAKE_PASSPORT, FAKE_TICKET, FAKE_BOOKING, FAKE_BIRTHDATE, FAKE_CARD, '60000', '60.000']) {
    assertFalse(text.includes(secret), 'no debe aparecer ' + secret);
  }
});

Deno.test('mapeo: fee → feesLines, "por persona" × viajeros, y serviceId en la línea de un servicio', () => {
  // El price del servicio solo sirve para asociar la línea con el servicio (no crea otra línea).
  const tour = service({ type: 'activity', name: 'Cata de vinos', price: { amount: 100, per_person: true } });
  const data = extraction({
    travelers: { adults: 2, children: 1, children_ages: [8] },
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [tour] }],
    pricing: {
      currency: 'EUR',
      total: null,
      other_currencies: [],
      lines: [
        { concept: 'Cata de vinos', detail: 'con almuerzo', amount: 100, quantity: null, unit_price: null, per_person: true, kind: 'service' },
        { concept: 'Tasa turística', detail: null, amount: 30, quantity: 1, unit_price: 30, per_person: false, kind: 'fee' }
      ]
    }
  });
  const p = mapExtractionToProposal(data);
  assertEquals(p.currency, 'EUR');
  assertEquals(p.travelersCount, 3);
  assertEquals(p.content.pricing.lines.length, 1);
  assertEquals(p.content.pricing.lines[0].label, 'Cata de vinos — con almuerzo');
  assertEquals([p.content.pricing.lines[0].quantity, p.content.pricing.lines[0].unitPrice], [3, 100]); // adultos + niños
  // La línea se asoció al servicio del mismo concepto: usa su id nuevo.
  assertEquals(p.content.pricing.lines[0].serviceId, p.content.days[0].services[0].id);
  assertEquals(p.content.pricing.feesLines.map((l) => [l.label, l.quantity, l.unitPrice]), [['Tasa turística', 1, 30]]);
});

Deno.test('mapeo: el price de un servicio crea la línea solo si el PDF no trae pricing.lines', () => {
  const priced = service({ type: 'activity', name: 'Paseo', price: { amount: 50, per_person: false } });
  const day = [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [priced] }];
  const sin = mapExtractionToProposal(extraction({ days: day }));
  assertEquals(sin.content.pricing.lines.length, 1);
  assertEquals(sin.content.pricing.lines[0].serviceId, sin.content.days[0].services[0].id);

  const con = mapExtractionToProposal(
    extraction({
      days: day,
      pricing: { currency: 'USD', total: 50, other_currencies: [], lines: [{ concept: 'Paseo', detail: null, amount: 50, quantity: 1, unit_price: 50, per_person: false, kind: 'service' }] }
    })
  );
  assertEquals(con.content.pricing.lines.length, 1); // sin duplicar
});

Deno.test('mapeo: pricing null → sin líneas y moneda por defecto; lo que falta queda vacío', () => {
  const p = mapExtractionToProposal(extraction());
  assertEquals(p.content.pricing, { lines: [], feesLines: [] });
  assertEquals(p.currency, 'USD');
  assertEquals([p.clientName, p.clientEmail, p.clientPhone, p.destinationText, p.startDate, p.endDate, p.travelersCount], ['', null, null, null, null, null, null]);
  assertEquals(p.content.cover.title, '');
  assertEquals(p.content.days, []);
});

Deno.test('mapeo: un correo con formato inválido no se guarda (la base lo rechazaría)', () => {
  const p = mapExtractionToProposal(extraction({ client: { name: 'X', email: 'no es un correo', phone: null } }));
  assertEquals(p.clientEmail, null);
});

Deno.test('mapeo: ningún texto del PDF llega a los campos de HTML enriquecido', () => {
  const data = rawVoucherExtraction();
  data.notes = ['<script>alert(1)</script> nota general'];
  data.inclusions = ['<b>incluye</b>'];
  data.exclusions = ['no incluye'];
  const { content } = mapExtractionToProposal(postProcessExtraction(data).extraction);
  assertEquals(content.welcome.body, '');
  assertEquals(content.intro, { headline: '', body: '' });
  assertEquals(content.terms.body, '');
  assertEquals(content.terms.title, 'Términos y condiciones');
  // Inclusiones, exclusiones y notas generales no se aplican.
  assertFalse(JSON.stringify(content).includes('nota general'));
  assertFalse(JSON.stringify(content).includes('incluye</b>'));
});

Deno.test('mapeo: ids únicos y números de día sin repetir', () => {
  const data = extraction({
    days: [
      { number: 2, date: null, base_city: null, title: null, summary: null, services: [] },
      { number: 2, date: null, base_city: null, title: null, summary: null, services: [] }
    ]
  });
  const days = mapExtractionToProposal(data).content.days;
  assertEquals(days.map((d) => d.dayNumber), [2, 3]);
  assertEquals(new Set(days.map((d) => d.id)).size, 2);
  const ids = voucher().content.days.flatMap((d) => [d.id, ...d.services.map((s) => s.id)]);
  assertEquals(new Set(ids).size, ids.length);
  ids.forEach((id) => assertMatch(id, UUID));
});
