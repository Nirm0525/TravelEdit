// Fixture INVENTADO de un PDF "rico" (descripciones largas de día y de servicio, vuelo que llega al día siguiente,
// hotel, traslado privado, actividad con guía y recomendaciones, inclusiones, exclusiones, consejos, precios reales,
// extra de equipaje y coberturas de seguro) más datos sensibles que deben desaparecer. Lugares, aerolínea, códigos
// y personas son ficticios; los números de pasaporte, boleto, etc. son valores de prueba.
import type { Extraction } from './proposal-extraction.ts';
import { extraction, flight, hotel, service } from './test-fixtures.ts';

export const RICH_PASSPORT = 'QR7654321';
export const RICH_TICKET = '987-6543210987';
export const RICH_BOOKING = 'LM8N2P';
export const RICH_BIRTHDATE = '02/09/1990';
export const RICH_SEAT = '14C';
export const RICH_SENSITIVE = [RICH_PASSPORT, RICH_TICKET, RICH_BOOKING, RICH_BIRTHDATE, `Asiento ${RICH_SEAT}`];

export const SANTIAGO_SUMMARY =
  'Santiago de Isla Sur es una ciudad rodeada de montañas, con un centro histórico peatonal, mercados de frutas y una vida gastronómica muy activa. ' +
  'Es un buen punto de partida para conocer los valles vecinos, con museos que conservan documentos históricos y el nacimiento de la ciudad en el siglo XVI.';

export const WINERY_DESCRIPTION =
  'Recorrido por los viñedos de la bodega Valle Azul, a una hora de la ciudad, con explicación del proceso de elaboración del vino.\n\n' +
  'Se visitan la sala de barricas, la bodega histórica y un mirador sobre el valle. Termina con una degustación de tres vinos y un almuerzo de cuatro tiempos.\n\n' +
  'Guía: guía de habla hispana durante todo el recorrido. Recomendaciones: lleve calzado cómodo y protector solar. Pickup en el lobby del hotel.';

export const WINERY_EXTRA = 'Se recomienda reservar con anticipación en temporada alta.';

export const RICH_TIPS = {
  passport: 'Lleve su pasaporte durante todo el viaje.',
  airport: 'En Santiago de Isla Sur, use solo transporte autorizado desde el aeropuerto.',
  weather: 'El clima de noviembre es templado: lleve ropa ligera y un abrigo para la noche.'
};

export function rawRichExtraction(): Extraction {
  const longFlight = flight('Vuelo Ciudad Norte – Santiago de Isla Sur', 'ZX 880', {
    airline: 'Aerolínea Ficticia',
    origin: 'Ciudad Norte (CNO)',
    destination: 'Santiago de Isla Sur (SIS)',
    departure_time: '23:10',
    arrival_time: '02:48',
    arrival_date: '2026-11-19',
    cabin: 'Económica',
    baggage: '1 maleta de 23 kg'
  });
  longFlight.date = '2026-11-18';
  longFlight.description = `Vuelo nocturno. Localizador ${RICH_BOOKING}. Asiento ${RICH_SEAT}. Boleto electrónico ${RICH_TICKET}.`;
  longFlight.location = 'Terminal 2';

  const arrivalTransfer = service({
    type: 'transfer',
    name: 'Traslado aeropuerto – hotel',
    date: '2026-11-19',
    time: '03:30',
    modality: 'private',
    location: 'Terminal internacional, puerta B',
    description: 'Duración aproximada: 40 minutos. Un coordinador espera con un cartel con el nombre.',
    transfer: { from: 'Aeropuerto de Santiago de Isla Sur', to: 'Hotel Faro Santiago', vehicle_type: 'Van privada', passengers: '2', baggage: '2 maletas' }
  });

  const stay = hotel('Hotel Faro Santiago', '2026-11-19', '2026-11-21', {
    check_in_time: '15:00',
    check_out_time: '12:00',
    room_type: 'Habitación Superior',
    meal_plan: 'Desayuno incluido',
    category: '5 estrellas',
    address: 'Avenida Ejemplo 100',
    guests: '2 adultos'
  });
  stay.description = `Hotel boutique en el centro. Titular con pasaporte N° ${RICH_PASSPORT}. Fecha de nacimiento: ${RICH_BIRTHDATE}.`;

  const winery = (description: string) =>
    service({
      type: 'activity',
      name: 'Bodega Valle Azul',
      date: '2026-11-20',
      time: '09:30',
      modality: 'shared',
      description,
      notes: 'No incluye propinas.',
      activity: {
        duration: '5 horas',
        meeting_point: 'Lobby del hotel',
        participants: '2 personas',
        included: 'Degustación de 3 vinos y almuerzo',
        language: 'Español'
      }
    });

  const insurance = service({
    type: 'other',
    name: 'Plan Viaje Seguro Plus',
    date: '2026-11-18',
    description: 'Vigencia durante todo el viaje. Cobertura de asistencia médica y de equipaje.'
  });

  return extraction({
    client: { name: 'Persona Ejemplo', email: 'persona@ejemplo.test', phone: '+5491155550000' },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Santiago y sus valles', start_date: '2026-11-18', end_date: '2026-11-22', destinations: ['Santiago de Isla Sur', 'Valle Azul'] },
    days: [
      { number: 1, date: '2026-11-18', base_city: 'Ciudad Norte', title: 'Salida', summary: null, services: [longFlight, insurance] },
      { number: 2, date: '2026-11-19', base_city: 'Santiago de Isla Sur', title: 'Llegada a Santiago', summary: SANTIAGO_SUMMARY, services: [arrivalTransfer, stay] },
      { number: 3, date: '2026-11-20', base_city: 'Santiago de Isla Sur', title: 'Valle Azul', summary: null, services: [winery(WINERY_DESCRIPTION)] },
      // El mismo día 3 repetido en otra sección del PDF, con la misma bodega y un texto distinto.
      { number: 3, date: null, base_city: null, title: null, summary: null, services: [winery(WINERY_EXTRA)] }
    ],
    pricing: {
      currency: 'USD',
      total: 3370,
      other_currencies: [],
      lines: [
        { concept: 'Paquete Santiago y sus valles', detail: null, amount: 3200, quantity: 1, unit_price: 3200, per_person: false, kind: 'service' },
        { concept: 'Equipaje adicional', detail: 'maleta de 23 kg por persona', amount: 60, quantity: 2, unit_price: 60, per_person: true, kind: 'service' },
        { concept: 'Tasa de servicio', detail: null, amount: 50, quantity: 1, unit_price: 50, per_person: false, kind: 'fee' },
        { concept: 'Cobertura de equipaje', detail: 'por demora, hasta USD 500', amount: 500, quantity: null, unit_price: null, per_person: false, kind: 'service' },
        { concept: 'Cobertura de asistencia médica', detail: 'hasta USD 60.000', amount: 60000, quantity: null, unit_price: null, per_person: false, kind: 'service' }
      ]
    },
    inclusions: ['Desayunos diarios', 'Traslados privados'],
    exclusions: ['Vuelos internacionales', 'Propinas'],
    notes: [RICH_TIPS.passport, RICH_TIPS.airport, RICH_TIPS.weather, `Fecha de nacimiento: ${RICH_BIRTHDATE}.`],
    missing: []
  });
}
