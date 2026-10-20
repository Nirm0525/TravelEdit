import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { buildPreview } from './proposal-import-preview';

type Service = StoredExtraction['days'][number]['services'][number];

/** Datos INVENTADOS: una extracción rica con datos sensibles que la vista previa nunca debe mostrar. */
const svc = (name: string, type: Service['type'], extra: Partial<Service> = {}): Service => ({
  type, subtype: null, name, date: null, time: null, location: null, description: null, notes: null, modality: null,
  price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null, ...extra
});

const SUMMARY = 'Santiago de Isla Sur es una ciudad rodeada de montañas, con un centro histórico peatonal y mercados de frutas.';
const LONG_DESCRIPTION =
  'Recorrido por los viñedos con explicación del proceso de elaboración del vino. Se visita la sala de barricas y un mirador. ' +
  'Guía de habla hispana. Recomendaciones: lleve calzado cómodo. Pickup en el lobby del hotel.';

function rich(): StoredExtraction {
  return {
    client: { name: 'Persona Ejemplo', email: null, phone: null },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Santiago y sus valles', start_date: '2026-11-18', end_date: '2026-11-22', destinations: ['Santiago de Isla Sur'] },
    days: [
      {
        number: 1, date: '2026-11-18', base_city: 'Ciudad Norte', title: 'Salida', summary: SUMMARY,
        services: [
          svc('Vuelo a Santiago', 'flight', {
            date: '2026-11-18',
            location: 'Terminal 2',
            description: 'Vuelo nocturno. Localizador XK4P9Q. Asiento 14C. Boleto 123-4567890123.',
            flight: {
              airline: 'Aerolínea Ficticia', flight_number: 'ZX 880', origin: 'Ciudad Norte', destination: 'Santiago de Isla Sur',
              departure_time: '23:10', arrival_time: '02:48', arrival_date: '2026-11-19', cabin: 'Económica', baggage: '1 maleta de 23 kg'
            }
          }),
          svc('Hotel Faro', 'hotel', {
            description: 'Titular con pasaporte N° AB1234567. Fecha de nacimiento: 14/03/1985.',
            hotel: {
              check_in_date: '2026-11-19', check_out_date: '2026-11-21', check_in_time: '15:00', check_out_time: '12:00',
              room_type: 'Habitación Superior', meal_plan: 'Desayuno incluido', category: '5 estrellas', address: 'Avenida Ejemplo 100', guests: '2 adultos'
            }
          }),
          svc('Traslado al hotel', 'transfer', {
            modality: 'private',
            transfer: { from: 'Aeropuerto', to: 'Hotel Faro', vehicle_type: 'Van privada', passengers: '2', baggage: '2 maletas' }
          }),
          svc('Bodega Valle Azul', 'activity', {
            description: LONG_DESCRIPTION,
            notes: 'No incluye propinas.',
            activity: { duration: '5 horas', meeting_point: 'Lobby del hotel', participants: '2 personas', included: 'Degustación de 3 vinos', language: 'Español' }
          })
        ]
      }
    ],
    pricing: null, inclusions: [], exclusions: [], notes: [], missing: [], warnings: [],
    meta: { model: 'm', extracted_at: '2027-01-01T00:00:00Z' }
  };
}

const factsOf = (s: { facts: { label: string; value: string }[] }) => Object.fromEntries(s.facts.map((f) => [f.label, f.value]));

describe('buildPreview: extracción rica', () => {
  const preview = () => buildPreview(rich());

  it('muestra el resumen del día', () => {
    expect(preview().days[0].summary).toBe(SUMMARY);
  });

  it('un día sin resumen no muestra nada', () => {
    const data = rich();
    data.days[0].summary = null;
    expect(buildPreview(data).days[0].summary).toBeNull();
  });

  it('vuelo: aerolínea, número, ruta, salida, llegada con fecha, clase y equipaje', () => {
    const flight = factsOf(preview().days[0].services[0]);
    expect(flight['Vuelo']).toBe('Aerolínea Ficticia ZX 880');
    expect(flight['Ruta']).toBe('Ciudad Norte → Santiago de Isla Sur');
    expect(flight['Salida']).toContain('23:10');
    expect(flight['Llegada']).toContain('02:48');
    expect(flight['Llegada']).toContain('2026');
    expect(flight['Clase']).toBe('Económica');
    expect(flight['Equipaje']).toBe('1 maleta de 23 kg');
    expect(flight['Lugar']).toBe('Terminal 2');
  });

  it('hotel: check-in/out, noches, habitación, régimen, categoría, huéspedes y dirección', () => {
    const hotel = factsOf(preview().days[0].services[1]);
    expect(hotel['Check-in']).toContain('15:00');
    expect(hotel['Check-out']).toContain('12:00');
    expect(hotel['Noches']).toBe('2');
    expect(hotel['Habitación']).toBe('Habitación Superior');
    expect(hotel['Régimen']).toBe('Desayuno incluido');
    expect(hotel['Categoría']).toBe('5 estrellas');
    expect(hotel['Huéspedes']).toBe('2 adultos');
    expect(hotel['Dirección']).toBe('Avenida Ejemplo 100');
  });

  it('traslado: ruta, vehículo, pasajeros, equipaje y modalidad', () => {
    const transfer = preview().days[0].services[2];
    expect(transfer.modality).toBe('Privado');
    expect(factsOf(transfer)).toEqual({ Ruta: 'Aeropuerto → Hotel Faro', Vehículo: 'Van privada', Pasajeros: '2', Equipaje: '2 maletas' });
  });

  it('actividad: duración, punto de encuentro, participantes, idioma, incluye, no incluye y descripción completa', () => {
    const tour = preview().days[0].services[3];
    expect(tour.description).toBe(LONG_DESCRIPTION); // más de 220 caracteres, sin recortar
    expect(factsOf(tour)).toEqual({
      Duración: '5 horas',
      'Punto de encuentro': 'Lobby del hotel',
      Participantes: '2 personas',
      Idioma: 'Español',
      Incluye: 'Degustación de 3 vinos',
      'No incluye': 'No incluye propinas.'
    });
  });

  it('no muestra localizadores, boletos, asientos, pasaportes ni fechas de nacimiento', () => {
    const json = JSON.stringify(preview());
    for (const value of ['XK4P9Q', '14C', '123-4567890123', 'AB1234567', '14/03/1985']) {
      expect(json).not.toContain(value);
    }
    // El texto genérico que rodeaba al dato sí se conserva.
    expect(preview().days[0].services[0].description).toContain('Vuelo nocturno');
  });

  it('el resumen del día se limita a un tope alto, sin recortar textos normales', () => {
    const data = rich();
    data.days[0].summary = 'palabra '.repeat(300);
    const summary = buildPreview(data).days[0].summary!;
    expect(summary.length).toBeLessThanOrEqual(900);
    expect(summary.endsWith('…')).toBe(true);
  });
});
