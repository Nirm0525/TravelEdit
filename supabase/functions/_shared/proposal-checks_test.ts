import { assertEquals } from 'jsr:@std/assert@1';
import { runCoherenceChecks } from './proposal-checks.ts';
import { extraction, hotel, matchingExtraction, service } from './test-fixtures.ts';

const codes = (data: ReturnType<typeof extraction>) => runCoherenceChecks(data).map((w) => w.code);

Deno.test('coherencia: una extracción consistente no genera avisos', () => {
  assertEquals(codes(matchingExtraction()), []);
});

Deno.test('coherencia: la suma de quantity × unit_price no coincide con el total', () => {
  const data = matchingExtraction();
  data.pricing!.total = 3100;
  assertEquals(codes(data), ['price_total_mismatch']);
});

Deno.test('coherencia: tolerancia de 1 unidad de la moneda', () => {
  const data = matchingExtraction();
  data.pricing!.total = 3001;
  assertEquals(codes(data), []);
  data.pricing!.total = 3001.5;
  assertEquals(codes(data), ['price_total_mismatch']);
});

Deno.test('coherencia: "por persona" usa adultos + niños; sin viajeros conocidos avisa', () => {
  const data = extraction({
    travelers: { adults: 2, children: 1, children_ages: [8] },
    pricing: {
      currency: 'USD',
      total: 300,
      other_currencies: [],
      lines: [{ concept: 'Tour', detail: null, amount: 100, quantity: null, unit_price: null, per_person: true, kind: 'service' }]
    }
  });
  assertEquals(codes(data), []); // 3 × 100
  data.travelers = { adults: null, children: null, children_ages: [] };
  assertEquals(codes(data), ['price_per_person_unknown_travelers', 'price_total_mismatch']);
});

Deno.test('coherencia: más de una moneda va a warnings', () => {
  const data = matchingExtraction();
  data.pricing!.other_currencies = ['EUR'];
  assertEquals(codes(data), ['multiple_currencies']);
});

Deno.test('coherencia: fechas de servicios fuera del rango del viaje', () => {
  const data = matchingExtraction();
  data.days[1].services.push(service({ type: 'activity', name: 'Tour tardío', date: '2027-04-01' }));
  assertEquals(codes(data), ['dates_outside_trip']);
});

Deno.test('coherencia: número de días distinto al de las fechas', () => {
  const data = matchingExtraction();
  data.days.pop();
  assertEquals(codes(data), ['day_count_mismatch']);
});

Deno.test('coherencia: hoteles con noches traslapadas', () => {
  const data = matchingExtraction();
  data.days[0].services.push(hotel('Hotel B', '2027-03-11', '2027-03-12'));
  assertEquals(codes(data), ['hotel_nights_overlap']);
});

Deno.test('coherencia: noches sin hotel', () => {
  const data = matchingExtraction();
  data.days[0].services[1] = hotel('Hotel Savoy', '2027-03-10', '2027-03-11');
  const warnings = runCoherenceChecks(data);
  assertEquals(warnings.map((w) => w.code), ['hotel_nights_uncovered']);
  assertEquals(warnings[0].message.includes('2027-03-11'), true);
});

Deno.test('coherencia: sin fechas de hotel no se inventan avisos', () => {
  const data = matchingExtraction();
  data.days[0].services = [service({ type: 'hotel', name: 'Hotel sin fechas' })];
  assertEquals(codes(data), []);
});
