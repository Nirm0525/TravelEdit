import { assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { PRIVACY_NOTICE, scrubSensitive, scrubText } from './proposal-sanitize.ts';
import { extraction, service } from './test-fixtures.ts';
import { FAKE_BIRTHDATE, FAKE_BOOKING, FAKE_CARD, FAKE_PASSPORT, FAKE_PHONE, FAKE_TICKET } from './test-fixtures-voucher.ts';

Deno.test('sensibles: boleto electrónico de 13 dígitos (con y sin guion)', () => {
  assertEquals(scrubText('Boleto 1234567890123 emitido').removed, { tickets: 1 });
  assertEquals(scrubText(`Boleto ${FAKE_TICKET}.`).text, 'Boleto.');
  assertEquals(scrubText('Total 12345678901').removed, {}); // 11 dígitos: no es boleto
});

Deno.test('sensibles: pasaportes y documentos, con etiqueta o con forma de pasaporte', () => {
  assertEquals(scrubText(`Pasaporte N° ${FAKE_PASSPORT}`).text, '');
  assertEquals(scrubText('Passport no. X1234567 valid').text, 'valid');
  assertEquals(scrubText('DNI 12345678').removed, { documents: 1 });
  assertEquals(scrubText('RUT 12.345.678-9').removed, { documents: 1 });
  assertEquals(scrubText(`Titular ${FAKE_PASSPORT} viaja`).text, 'Titular viaja'); // código suelto
  // No toca números de vuelo ni palabras normales.
  assertEquals(scrubText('Vuelo ZX 101 con documento válido').removed, {});
});

Deno.test('sensibles: fecha de nacimiento solo con etiqueta; fechas del viaje intactas', () => {
  assertEquals(scrubText(`Fecha de nacimiento: ${FAKE_BIRTHDATE}`).text, '');
  assertEquals(scrubText('DOB 1985-03-14').removed, { birthdates: 1 });
  assertEquals(scrubText('Nacimiento: 14 de marzo de 1985').removed, { birthdates: 1 });
  assertEquals(scrubText('Del 2027-05-04 al 2027-05-07').removed, {});
});

Deno.test('sensibles: localizador, asiento y tarjeta', () => {
  assertEquals(scrubText(`Localizador ${FAKE_BOOKING}`).text, '');
  assertEquals(scrubText('Código de reserva: AB12CD').removed, { bookings: 1 });
  assertEquals(scrubText('Asiento 12A / 12B').removed, { seats: 1 });
  assertEquals(scrubText(`Tarjeta ${FAKE_CARD}`).removed, { cards: 1 });
  assertEquals(scrubText(`Pago ${FAKE_CARD}`).removed, { cards: 1 }); // sin etiqueta: pasa Luhn
  assertEquals(scrubText('Tarjeta terminada en **** 4242').removed, { cards: 1 });
  assertEquals(scrubText('Pago 4111 1111 1111 1112').removed, {}); // no pasa Luhn: no es una tarjeta
});

Deno.test('sensibles: una fecha doble o un teléfono con espacios no se confunden con una tarjeta', () => {
  assertEquals(scrubText('2027-05-04 2027-05-07').removed, {});
  assertEquals(scrubText('Tel. +54 9 11 5555 1234').removed, {});
});

Deno.test('sensibles: scrubSensitive limpia todos los campos de texto y avisa sin incluir los valores', () => {
  const data = extraction({
    client: { name: 'Persona Ejemplo', email: 'persona@ejemplo.test', phone: FAKE_PHONE },
    days: [
      {
        number: 1,
        date: '2027-05-04',
        base_city: null,
        title: null,
        summary: `Pasaporte ${FAKE_PASSPORT}`,
        services: [service({ type: 'other', name: 'Seguro', description: `Boleto ${FAKE_TICKET}`, notes: `Localizador ${FAKE_BOOKING}` })]
      }
    ],
    notes: [`Nacimiento: ${FAKE_BIRTHDATE}`, 'Nota normal']
  });
  const { data: clean, warnings } = scrubSensitive(data);

  const text = JSON.stringify(clean);
  for (const secret of [FAKE_PASSPORT, FAKE_TICKET, FAKE_BOOKING, FAKE_BIRTHDATE]) {
    assertFalse(text.includes(secret), `quedó ${secret}`);
  }
  assertEquals(clean.client.phone, FAKE_PHONE); // un teléfono de 13 dígitos no es un boleto
  assertEquals(clean.notes, ['Nota normal']); // el elemento que quedó vacío desaparece
  assertEquals(warnings.length, 1);
  assertEquals(warnings[0].code, 'sensitive_data_removed');
  for (const secret of [FAKE_PASSPORT, FAKE_TICKET, FAKE_BOOKING, FAKE_BIRTHDATE]) {
    assertFalse(warnings[0].message.includes(secret), 'el warning no puede llevar el valor');
  }
  // El aviso es genérico: no dice qué dato era (pasaporte, nacimiento, boleto…) ni en qué campo estaba.
  assertEquals(warnings[0].message, PRIVACY_NOTICE);
  for (const word of ['pasaporte', 'nacimiento', 'boleto', 'localizador', 'asiento', 'tarjeta', 'days.0']) {
    assertFalse(warnings[0].message.toLowerCase().includes(word), `el aviso no debe mencionar «${word}»`);
  }
});

Deno.test('sensibles: no muta la entrada y un texto limpio no genera warning', () => {
  const data = extraction({ notes: ['Todo normal: llegada a las 10:30'] });
  const { data: clean, warnings } = scrubSensitive(data);
  assertEquals(warnings, []);
  assertEquals(clean, data);
});

Deno.test('sensibles: un nombre obligatorio que queda vacío recibe un marcador', () => {
  const data = extraction({
    days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [service({ type: 'other', name: FAKE_TICKET })] }]
  });
  assertEquals(scrubSensitive(data).data.days[0].services[0].name, '(sin nombre)');
});
