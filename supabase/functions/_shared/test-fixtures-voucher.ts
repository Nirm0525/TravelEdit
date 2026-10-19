// Fixture INVENTADO que reproduce los casos de un voucher real, sin usar datos de ningún PDF
// ni de clientes: lugares, aerolínea, códigos y personas son ficticios. Los números de
// pasaporte, boleto, tarjeta, etc. son valores de prueba.
//
// Casos:
//  - el mismo día repartido en dos secciones del PDF (con un servicio repetido);
//  - un vuelo con conexión (dos tramos) que llega al día siguiente (arrival_date);
//  - un seguro de viaje con montos de coberturas que NO deben ir a `pricing`;
//  - un pasaporte, un boleto, un asiento, un localizador, una fecha de nacimiento y una
//    tarjeta que deben eliminarse;
//  - modalidad privada/compartida.
import type { Extraction } from './proposal-extraction.ts';
import { extraction, flight, hotel, service } from './test-fixtures.ts';

export const FAKE_PASSPORT = 'AB1234567';
export const FAKE_TICKET = '123-4567890123';
export const FAKE_BOOKING = 'XK4P9Q';
export const FAKE_BIRTHDATE = '14/03/1985';
export const FAKE_CARD = '4111 1111 1111 1111'; // número de prueba clásico (pasa Luhn)
export const FAKE_PHONE = '+5491155550000'; // 13 dígitos: NO es un boleto

export function rawVoucherExtraction(): Extraction {
  const leg1 = flight('Vuelo Ciudad Norte – Isla Central', 'ZX 101', {
    airline: 'Aerolínea Ficticia',
    origin: 'Ciudad Norte (CNO)',
    destination: 'Isla Central (ICE)',
    departure_time: '08:00',
    arrival_time: '10:30',
    arrival_date: '2027-05-04'
  });
  const leg2 = flight('Vuelo Isla Central – Puerto Azul', 'ZX 202', {
    airline: 'Aerolínea Ficticia',
    origin: 'Isla Central (ICE)',
    destination: 'Puerto Azul (PAZ)',
    departure_time: '22:30',
    arrival_time: '01:10',
    arrival_date: '2027-05-05' // llega al día siguiente
  });

  const insurance = service({
    type: 'other',
    name: 'Plan Viaje Seguro Plus',
    date: '2027-05-04',
    description: `Vigencia del 2027-05-04 al 2027-05-07. Asistencia médica y equipaje. Titular con pasaporte N° ${FAKE_PASSPORT}.`,
    notes: `No incluye deportes extremos. Boleto electrónico ${FAKE_TICKET}. Pago con tarjeta ${FAKE_CARD}.`
  });

  const transfer = service({
    type: 'transfer',
    name: 'Traslado aeropuerto – hotel',
    time: '11:00',
    modality: 'private',
    transfer: { from: 'Aeropuerto de Puerto Azul', to: 'Hotel Faro', vehicle_type: 'Van 8 pax', passengers: '4', baggage: null }
  });

  const tour = service({
    type: 'activity',
    name: 'Paseo en barco',
    time: '16:00',
    modality: 'shared',
    description: `Salida del muelle. Asiento 12A. Localizador ${FAKE_BOOKING}. Nacimiento: ${FAKE_BIRTHDATE}.`
  });

  return extraction({
    client: { name: 'Persona Ejemplo', email: 'persona@ejemplo.test', phone: FAKE_PHONE },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Viaje de prueba', start_date: '2027-05-04', end_date: '2027-05-07', destinations: ['Isla Central', 'Puerto Azul'] },
    days: [
      // Sección "Itinerario": el día 1 con los vuelos y el seguro.
      { number: 1, date: '2027-05-04', base_city: 'Ciudad Norte', title: 'Salida', summary: null, services: [leg1, insurance, leg2] },
      // Sección "Alojamientos y traslados": el MISMO día 1, con un vuelo repetido y el hotel.
      {
        number: 1,
        date: null,
        base_city: 'Puerto Azul',
        title: null,
        summary: null,
        services: [leg2, hotel('Hotel Faro', '2027-05-04', '2027-05-06', { room_type: 'Doble' }), transfer]
      },
      { number: 2, date: '2027-05-05', base_city: 'Puerto Azul', title: null, summary: null, services: [tour] },
      { number: 3, date: '2027-05-06', base_city: 'Puerto Azul', title: null, summary: null, services: [] },
      { number: 4, date: '2027-05-07', base_city: 'Puerto Azul', title: null, summary: null, services: [] }
    ],
    pricing: {
      currency: 'USD',
      total: 2000,
      other_currencies: [],
      lines: [
        // Coberturas del seguro y política de equipaje: NO son precios del viaje.
        { concept: 'Cobertura de asistencia médica', detail: 'hasta USD 60.000', amount: 60000, quantity: null, unit_price: null, per_person: false, kind: 'service' },
        { concept: 'Equipaje extraviado', detail: 'hasta USD 1.200', amount: 1200, quantity: null, unit_price: null, per_person: false, kind: 'service' },
        { concept: 'Penalidad por cambio de fecha', detail: null, amount: 150, quantity: null, unit_price: null, per_person: false, kind: 'fee' },
        // El precio real, de una sección explícita de tarifas.
        { concept: 'Paquete Isla Central y Puerto Azul', detail: null, amount: 2000, quantity: 1, unit_price: 2000, per_person: false, kind: 'service' }
      ]
    }
  });
}
