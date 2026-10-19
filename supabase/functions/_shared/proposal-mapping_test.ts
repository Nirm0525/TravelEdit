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
  assertEquals(days[0].services.length, 4); // el día repartido en dos secciones quedó unido; la asistencia (general) ya no está en el día
});

Deno.test('mapeo: servicios con ficha por tipo, modalidad y subtype', () => {
  const services = voucher().content.days[0].services;
  const [leg1, leg2, hotel, transfer] = services;

  assertEquals(leg1.type, 'flight');
  assertEquals(leg1.time, '08:00'); // salida
  assertEquals(leg1.details.flightNumber, 'ZX 101');
  assertEquals(leg1.details.arrivalTime, '10:30');
  assertEquals(leg1.details.arrivalDate, '2027-05-04');

  assertEquals(leg2.time, '22:30');
  assertEquals([leg2.details.arrivalTime, leg2.details.arrivalDate], ['01:10', '2027-05-05']); // llega al día siguiente

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
  // Las inclusiones y exclusiones generales no se aplican; las notas van a Travel Tips (texto plano que el
  // constructor y el sitio público muestran escapado, nunca como HTML).
  assertFalse(JSON.stringify(content).includes('incluye</b>'));
  assert(content.travelTips[0].tips.some((t) => t.body === '<script>alert(1)</script> nota general'));
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

// ---------------------------------------------------------------- cierre de calidad: inclusiones, notas y servicios

import { GENERAL_TIPS_DESTINATION } from './proposal-mapping.ts';
import { FAKE_PASSPORT_2, rawThirteenDayExtraction } from './test-fixtures-voucher.ts';

const thirteen = () => mapExtractionToProposal(postProcessExtraction(rawThirteenDayExtraction()).extraction);
const serviceNamed = (p: ReturnType<typeof thirteen>, fragment: string) =>
  p.content.days.flatMap((d) => d.services).find((s) => s.title.includes(fragment))!;

Deno.test('mapeo: las notas generales van a Travel Tips (un grupo «General», un consejo por nota, texto plano)', () => {
  const { travelTips } = thirteen().content;
  assertEquals(travelTips.length, 1);
  assertEquals(travelTips[0].destination, GENERAL_TIPS_DESTINATION);
  const notes = travelTips[0].tips.filter((t) => t.category !== 'safety');
  assertEquals(notes.map((t) => t.body), [
    'Lleve su pasaporte durante todo el viaje.', // el consejo general se conserva, sin el número
    'El clima es variable: lleve abrigo y calzado cómodo.'
  ]);
  // Solo los campos que el constructor entiende: id, title, body, category.
  for (const group of travelTips) {
    assertEquals(Object.keys(group).sort(), ['destination', 'id', 'tips']);
    for (const tip of group.tips) {
      assertEquals(Object.keys(tip).sort(), ['body', 'category', 'id', 'title']);
      assertMatch(tip.id, UUID);
      assert(tip.title.length > 0, 'el constructor muestra «Sin título» si falta');
    }
  }
  // Clima y equipaje se clasifica; el resto queda como consejo general (categoría vacía).
  assertEquals(notes.map((t) => t.category), ['', 'weather']);
});

Deno.test('mapeo: sin notas no se crea ningún grupo de consejos, y las notas repetidas no se duplican', () => {
  const none = mapExtractionToProposal(extraction({ notes: [] }));
  assertEquals(none.content.travelTips, []);
  const dup = mapExtractionToProposal(extraction({ notes: ['Lleve abrigo.', ' lleve abrigo. ', '', 'Otra nota'] }));
  assertEquals(dup.content.travelTips[0].tips.map((t) => t.body), ['Lleve abrigo.', 'Otra nota']);
});

Deno.test('mapeo: las inclusiones y exclusiones GENERALES no se copian a ningún campo de la propuesta', () => {
  const text = JSON.stringify(thirteen().content);
  assertFalse(text.includes('Traslados indicados en el itinerario'));
  assertFalse(text.includes('Vuelos internacionales'));
  // El cuerpo de los términos y de la bienvenida (los únicos HTML) siguen vacíos.
  const { welcome, intro, terms } = thirteen().content;
  assertEquals([welcome.body, intro.body, terms.body], ['', '', '']);
});

Deno.test('mapeo: lo incluido en un servicio viaja con ese servicio (details.included), «No incluye» en notes', () => {
  const p = thirteen();
  assertEquals(serviceNamed(p, 'Bodega').details.included, 'Degustación de 3 vinos y guía');
  assertEquals(serviceNamed(p, 'Cruce').details.included, 'Traslados y guía bilingüe');
  assertEquals(serviceNamed(p, 'Cruce').details.language, 'Español e inglés');
  assertEquals(serviceNamed(p, 'tango').details.included, 'Cena con entrada, plato principal, postre, vino y agua');
});

Deno.test('mapeo: la cena show queda como actividad (sin subtype) y la asistencia al viajero como «Otro» descriptivo', () => {
  const p = thirteen();
  const tango = serviceNamed(p, 'tango');
  assertEquals([tango.type, tango.subtype, tango.time], ['activity', undefined, '19:30']);
  assertEquals(tango.details.modality, 'Compartido');
  // La asistencia al viajero vale para todo el viaje: no queda dentro de ningún día…
  assertEquals(p.content.days.flatMap((d) => d.services).filter((s) => s.title.includes('Titanium')).length, 0);
  // …tampoco se convierte en Travel Tips (una asistencia contratada no es un consejo) ni llega a ProposalContent:
  // ProposalContent no tiene un lugar para servicios generales.
  assertEquals(p.content.travelTips[0].tips.some((t) => t.title.includes('Titanium') || t.category === 'safety'), false);
  assertFalse(JSON.stringify(p.content).includes('Titanium'));
});

Deno.test('mapeo: los límites de cobertura de la asistencia NO se convierten en líneas de precio', () => {
  const { pricing } = thirteen().content;
  assertEquals(pricing, { lines: [], feesLines: [] });
  const p = thirteen();
  assertEquals(p.currency, 'USD'); // sin precios: moneda por defecto, como siempre
});

Deno.test('mapeo: cliente y viajeros — el contrato solo admite nombre principal y cantidad', () => {
  const p = thirteen();
  assertEquals([p.clientName, p.travelersCount], ['Persona Ejemplo', 2]);
});

Deno.test('revisión con el voucher de referencia: los seis casos del viaje de 13 días', () => {
  const p = thirteen();
  const day = (n: number) => p.content.days.find((d) => d.dayNumber === n)!.services[0];

  // Día 3 — bodega: actividad, 14:00, compartido, con degustación y guía.
  const bodega = day(3);
  assertEquals([bodega.type, bodega.time, bodega.details.modality, bodega.details.included], ['activity', '14:00', 'Compartido', 'Degustación de 3 vinos y guía']);
  // Día 4 — paseo por la costa: actividad, 08:30, compartido.
  const costa = day(4);
  assertEquals([costa.type, costa.time, costa.details.modality], ['activity', '08:30', 'Compartido']);
  // Día 5 — vuelo: ruta y horas.
  const vuelo = day(5);
  assertEquals([vuelo.type, vuelo.time, vuelo.details.flightNumber, vuelo.details.origin, vuelo.details.destination, vuelo.details.arrivalTime], [
    'flight', '08:52', 'ZX 1627', 'Ciudad Norte', 'Puerto Lago', '10:40'
  ]);
  // Día 6 — cruce: actividad, 08:00, con traslados y guía bilingüe.
  const cruce = day(6);
  assertEquals([cruce.type, cruce.time, cruce.details.included], ['activity', '08:00', 'Traslados y guía bilingüe']);
  // Día 11 — cena show: actividad (no comida), 19:30, compartido, cena incluida.
  const tango = day(11);
  assertEquals([tango.type, tango.subtype, tango.time, tango.details.modality], ['activity', undefined, '19:30', 'Compartido']);
  assert(tango.details.included.startsWith('Cena con entrada'));
  // Día 13 — la asistencia al viajero es general: no está en el día, no es un consejo y no lleva precio.
  assertEquals(p.content.days.find((d) => d.dayNumber === 13)!.services, []);
  assertFalse(JSON.stringify(p.content).includes('Titanium'));
  assertEquals(p.content.pricing, { lines: [], feesLines: [] });
});

Deno.test('mapeo: ningún dato sensible del viaje de 13 días llega a proposals.content', () => {
  const text = JSON.stringify(thirteen());
  assertFalse(text.includes(FAKE_PASSPORT_2));
  assertFalse(/nacimiento/i.test(text));
});

Deno.test('servicio general: la asistencia al viajero no queda en ningún día y los precios por servicio siguen alineados', () => {
  const data = rawThirteenDayExtraction();
  // Un servicio con precio explícito después de la asistencia, para comprobar que los índices no se corren.
  const hotelDay = data.days[0];
  hotelDay.services.unshift(data.days[5].services[0]); // la asistencia, primero en ese día
  hotelDay.services.push(service({ type: 'hotel', name: 'Hotel Faro', price: { amount: 500, per_person: false } }));
  data.pricing = null;
  const p = mapExtractionToProposal(postProcessExtraction(data).extraction);
  const day = p.content.days.find((d) => d.dayNumber === 3)!;
  assertEquals(day.services.some((s) => s.title.includes('Asistencia')), false);
  const hotel = day.services.find((s) => s.title === 'Hotel Faro')!;
  assertEquals(p.content.pricing.lines.map((l) => l.serviceId), [hotel.id]);
});

Deno.test('servicio general: con o sin resumen, la asistencia no llega a ProposalContent (ni día, ni consejo); las notas sí siguen siendo consejos', () => {
  const mapped = (description: string | null) =>
    mapExtractionToProposal(
      postProcessExtraction(
        extraction({
          days: [
            { number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'other', name: 'Seguro de viaje Global', description, notes: 'Deportes extremos' })] }
          ],
          notes: ['El clima es variable: lleve abrigo.']
        })
      ).extraction
    );
  for (const description of [null, 'Vigencia todo el viaje.']) {
    const p = mapped(description);
    assertEquals(p.content.days[0].services, []);
    const text = JSON.stringify(p.content);
    assertFalse(text.includes('Seguro de viaje Global'));
    assertFalse(text.includes('Deportes extremos'));
    assertFalse(text.includes('Vigencia todo el viaje'));
    // Las notas generales del viaje siguen convirtiéndose en consejos.
    assertEquals(p.content.travelTips[0].tips.map((t) => [t.body, t.category]), [['El clima es variable: lleve abrigo.', 'weather']]);
  }
});
