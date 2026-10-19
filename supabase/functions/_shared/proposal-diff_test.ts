import { assert, assertEquals } from 'jsr:@std/assert@1';
import { computeDiff } from './proposal-diff.ts';
import { parseTimeToHHMM, normalizeName } from './proposal-text.ts';
import { extraction, flight, hotel, matchingExtraction, proposalSnapshot, service } from './test-fixtures.ts';

Deno.test('diff: todo igual (nombres con tildes/mayúsculas, horas en otro formato)', () => {
  const diff = computeDiff(matchingExtraction(), proposalSnapshot());
  assertEquals(diff.services.map((s) => s.status), ['unchanged', 'unchanged', 'unchanged', 'unchanged']);
  assertEquals(diff.only_in_proposal.length, 0);
  assertEquals(diff.client.name.status, 'unchanged');
  assertEquals(diff.client.email.status, 'unchanged'); // mayúsculas distintas
  assertEquals(diff.client.phone.status, 'unchanged'); // formato distinto
  assertEquals(diff.travelers.status, 'unchanged');
  assertEquals(diff.trip.start_date.status, 'unchanged');
  assertEquals(diff.pricing.currency.status, 'unchanged');
  assertEquals(diff.pricing.total.status, 'unchanged');
  assertEquals(diff.pricing.lines.map((l) => l.status), ['unchanged', 'unchanged', 'unchanged']);
  assertEquals(diff.base_updated_at, '2027-01-05T10:00:00Z');
  assertEquals(diff.summary.services, { new: 0, changed: 0, unchanged: 4, only_in_proposal: 0 });
});

Deno.test('diff: el emparejamiento del vuelo es por número de vuelo + fecha, aunque el nombre cambie', () => {
  const data = matchingExtraction();
  data.days[0].services[0] = flight('Iberia Madrid–Florencia', 'ib579', { departure_time: '10:15' });
  const item = computeDiff(data, proposalSnapshot()).services[0];
  assertEquals(item.match, 'flight_number_and_date');
  assertEquals(item.status, 'changed'); // el nombre cambió
  assertEquals(item.changed_fields.map((f) => f.field), ['name']);
});

Deno.test('diff: hotel distinto en las mismas noches → changed, con ambos valores', () => {
  const data = matchingExtraction();
  data.days[0].services[1] = hotel('Hotel Brunelleschi', '2027-03-10', '2027-03-12', { room_type: 'Doble' });
  const item = computeDiff(data, proposalSnapshot()).services[1];
  assertEquals(item.status, 'changed');
  assertEquals(item.match, 'hotel_nights_overlap');
  assertEquals(item.current?.id, 'svc-hotel');
  const fields = Object.fromEntries(item.changed_fields.map((f) => [f.field, f]));
  assertEquals(fields.name.current, 'Hotel Savoy');
  assertEquals(fields.name.incoming, 'Hotel Brunelleschi');
  assertEquals(fields.roomType.current, 'Suite');
  assertEquals(fields.roomType.incoming, 'Doble');
});

Deno.test('diff: hotel en noches que no se traslapan ni coinciden por nombre → new', () => {
  const data = matchingExtraction();
  data.days[0].services[1] = hotel('Hotel Brunelleschi', '2027-04-01', '2027-04-03');
  const diff = computeDiff(data, proposalSnapshot());
  assertEquals(diff.services[1].status, 'new');
  assertEquals(diff.only_in_proposal.map((o) => o.service.id), ['svc-hotel']);
});

Deno.test('diff: servicio nuevo en el PDF', () => {
  const data = matchingExtraction();
  data.days[1].services.push(service({ type: 'activity', name: 'Paseo en globo' }));
  const diff = computeDiff(data, proposalSnapshot());
  const added = diff.services.find((s) => s.incoming.name === 'Paseo en globo')!;
  assertEquals(added.status, 'new');
  assertEquals(added.current, null);
  assertEquals(diff.summary.services.new, 1);
});

Deno.test('diff: servicio que solo está en la propuesta → only_in_proposal (nunca se borra)', () => {
  const data = matchingExtraction();
  data.days[1].services = [];
  const diff = computeDiff(data, proposalSnapshot());
  assertEquals(diff.only_in_proposal.map((o) => o.service.title), ['Cata de vinos']);
  assertEquals(diff.summary.services.only_in_proposal, 1);
});

Deno.test('diff: nombres con tildes y mayúsculas distintas se emparejan', () => {
  const data = matchingExtraction();
  data.days[0].services[2] = service({ type: 'activity', name: 'VÍSITA A LOS ÚFFIZI!!' });
  const item = computeDiff(data, proposalSnapshot()).services[2];
  assertEquals(item.status, 'unchanged');
  assertEquals(item.match, 'name_and_day');
});

Deno.test('diff: emparejamiento dudoso (dos servicios actuales iguales) → new, nunca changed', () => {
  const snapshot = proposalSnapshot();
  const day = (snapshot.content as { days: { services: unknown[] }[] }).days[0];
  day.services.push({ id: 'svc-dup', type: 'activity', title: 'visita a los uffizi', time: '', details: {} });
  const item = computeDiff(matchingExtraction(), snapshot).services[2];
  assertEquals(item.status, 'new');
  assertEquals(item.current, null);
});

Deno.test('diff: una hora vaga actual ("Tarde") frente a una hora concreta del PDF sí es un cambio', () => {
  const data = matchingExtraction();
  data.days[1].services[0] = service({ type: 'activity', name: 'Cata de vinos', time: '16:00' });
  const item = computeDiff(data, proposalSnapshot()).services[3];
  assertEquals(item.status, 'changed');
  assertEquals(item.changed_fields, [{ field: 'time', current: 'Tarde', incoming: '16:00' }]);
});

Deno.test('diff: días por fecha calculada; si start_date del PDF es otro, changed a nivel de viaje', () => {
  const data = matchingExtraction();
  data.trip.start_date = '2027-03-11';
  data.trip.end_date = '2027-03-13';
  data.days[0].date = '2027-03-11';
  data.days[1].date = '2027-03-12';
  const diff = computeDiff(data, proposalSnapshot());
  assertEquals(diff.trip.start_date, { status: 'changed', current: '2027-03-10', incoming: '2027-03-11' });
  // El día 1 del PDF (2027-03-11) cae sobre el día 2 de la propuesta (start + 1).
  assertEquals(diff.services[0].day.current_day_number, 2);
});

Deno.test('diff: sin fechas, los días se emparejan por dayNumber (respaldo)', () => {
  const data = matchingExtraction();
  data.days.forEach((d) => (d.date = null));
  const diff = computeDiff(data, proposalSnapshot({ start_date: null }));
  assertEquals(diff.services[3].day.current_day_number, 2);
  assertEquals(diff.services[3].status, 'unchanged');
});

Deno.test('diff: moneda distinta es changed a nivel de propuesta y el total se compara', () => {
  const data = matchingExtraction();
  data.pricing!.currency = 'EUR';
  data.pricing!.total = 3500;
  const diff = computeDiff(data, proposalSnapshot());
  assertEquals(diff.pricing.currency, { status: 'changed', current: 'USD', incoming: 'EUR' });
  assertEquals(diff.pricing.total.status, 'changed');
});

Deno.test('diff: líneas de precio — cambia el precio, línea nueva y fee separado', () => {
  const data = matchingExtraction();
  data.pricing!.lines[0] = { concept: 'Hotel Savoy', detail: null, amount: 2400, quantity: 2, unit_price: 1200, per_person: false, kind: 'service' };
  data.pricing!.lines.push({ concept: 'Seguro de viaje', detail: null, amount: 80, quantity: null, unit_price: null, per_person: true, kind: 'service' });
  data.pricing!.lines.push({ concept: 'Impuestos', detail: null, amount: 50, quantity: 1, unit_price: 50, per_person: false, kind: 'fee' });
  const lines = computeDiff(data, proposalSnapshot()).pricing.lines;
  assertEquals(lines[0].status, 'changed');
  assertEquals(lines[0].changed_fields.map((f) => f.field), ['unit_price']);
  assertEquals(lines[3].status, 'new');
  assertEquals(lines[3].incoming.quantity, 2); // por persona × 2 viajeros
  assertEquals(lines[4].kind, 'fee');
  assertEquals(lines[4].status, 'new');
});

Deno.test('diff: precio por servicio solo crea línea si el PDF no trae pricing.lines', () => {
  const withLines = matchingExtraction();
  withLines.days[1].services[0] = service({ type: 'activity', name: 'Cata de vinos', price: { amount: 1000, per_person: false } });
  const a = computeDiff(withLines, proposalSnapshot()).pricing.lines;
  assertEquals(a.length, 3); // sin duplicar
  assertEquals(a[1].service_ref, { day_index: 1, service_index: 0 }); // solo asigna el servicio

  const withoutLines = matchingExtraction();
  withoutLines.pricing!.lines = [];
  withoutLines.days[1].services[0] = service({ type: 'activity', name: 'Cata de vinos', price: { amount: 500, per_person: true } });
  const b = computeDiff(withoutLines, proposalSnapshot()).pricing.lines;
  assertEquals(b.length, 1);
  assertEquals(b[0].origin, 'service_price');
  assertEquals(b[0].incoming.quantity, 2);
  assertEquals(b[0].status, 'unchanged'); // coincide con la línea actual "Cata de vinos" (2 × 500)
});

Deno.test('diff: datos que el PDF no trae no cuentan como cambio; datos nuevos son new', () => {
  const diff = computeDiff(extraction(), proposalSnapshot({ client_phone: null }));
  assertEquals(diff.client.name.status, 'unchanged');
  const withPhone = computeDiff(extraction({ client: { name: null, email: null, phone: '+34 600 000 000' } }), proposalSnapshot({ client_phone: null }));
  assertEquals(withPhone.client.phone.status, 'new');
});

Deno.test('texto: normalizeName y parseTimeToHHMM', () => {
  assertEquals(normalizeName('  ÁRBOL, del  Sol!! '), 'arbol del sol');
  assertEquals(parseTimeToHHMM('9:30 a. m.'), '09:30');
  assertEquals(parseTimeToHHMM('9:30 p.m.'), '21:30');
  assertEquals(parseTimeToHHMM('12:05 AM'), '00:05');
  assertEquals(parseTimeToHHMM('21:15'), '21:15');
  assertEquals(parseTimeToHHMM('Mañana'), null);
  assert(parseTimeToHHMM('25:00') === null);
});
