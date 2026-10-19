import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { buildPreview, nightsBetween, redactSensitive, serviceFacts } from './proposal-import-preview';

// Cierre de calidad de la importación: datos útiles para comparar con el PDF y nada sensible en pantalla.
// Todo es inventado (sin datos de clientes reales).

type Svc = StoredExtraction['days'][number]['services'][number];

/** Servicio inventado con todos los campos del schema en null, más lo que se indique. */
function svc(name: string, type: Svc['type'], extra: Partial<Svc> = {}): Svc {
  return {
    type, subtype: null, name, date: null, time: null, location: null, description: null, notes: null, modality: null,
    price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null, ...extra
  } as Svc;
}

function extraction(over: Partial<StoredExtraction> = {}): StoredExtraction {
  return {
    client: { name: 'Persona Ejemplo', email: null, phone: null },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: null, start_date: '2027-06-01', end_date: '2027-06-13', destinations: ['Ciudad Norte'] },
    days: [],
    pricing: null,
    inclusions: [],
    exclusions: [],
    notes: [],
    missing: [],
    warnings: [],
    meta: { model: 'm', extracted_at: '2027-01-01T00:00:00Z' },
    ...over
  };
}

const FLIGHT = { airline: 'Aerolínea Ficticia', flight_number: 'ZX 1627', origin: 'Ciudad Norte', destination: 'Puerto Lago', departure_time: '08:52', arrival_time: '10:40', arrival_date: null, cabin: null, baggage: null };
const HOTEL = { check_in_date: '2027-06-05', check_out_date: '2027-06-08', check_in_time: '15:00', check_out_time: '12:00', room_type: 'Doble', meal_plan: null, category: null, address: null, guests: null };
const ACTIVITY = { duration: '3 horas', meeting_point: null, participants: null, included: 'Degustación de 3 vinos y guía', language: 'Español' };

function previewOf(...services: Svc[]) {
  return buildPreview(extraction({ days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services }] })).days[0].services;
}

const factsOf = (s: { facts: { label: string; value: string }[] }) => Object.fromEntries(s.facts.map((f) => [f.label, f.value]));

describe('vista previa: datos útiles para comparar con el PDF', () => {
  it('vuelo: número, ruta, salida y llegada (con la fecha si llega otro día)', () => {
    const [flight] = previewOf(svc('Vuelo a Puerto Lago', 'flight', { flight: { ...FLIGHT, arrival_date: '2027-06-06' } }));
    expect(flight.time).toBe('08:52');
    const facts = factsOf(flight);
    expect(facts['Vuelo']).toBe('Aerolínea Ficticia ZX 1627');
    expect(facts['Ruta']).toBe('Ciudad Norte → Puerto Lago');
    expect(facts['Llegada']).toContain('10:40');
    expect(facts['Llegada']).toContain('6'); // la fecha de llegada
  });

  it('hotel: check-in, check-out y noches', () => {
    const [hotel] = previewOf(svc('Hotel Faro', 'hotel', { hotel: HOTEL }));
    const facts = factsOf(hotel);
    expect(facts['Check-in']).toContain('15:00');
    expect(facts['Check-out']).toContain('12:00');
    expect(facts['Noches']).toBe('3');
    expect(facts['Habitación']).toBe('Doble');
  });

  it('noches: solo con fechas válidas y salida posterior', () => {
    expect(nightsBetween('2027-06-05', '2027-06-08')).toBe(3);
    expect(nightsBetween('2027-06-08', '2027-06-05')).toBeNull();
    expect(nightsBetween('2027-06-05', null)).toBeNull();
    expect(nightsBetween('no es fecha', '2027-06-05')).toBeNull();
  });

  it('actividad: descripción corta, duración, idioma, qué incluye y qué no incluye', () => {
    const [bodega] = previewOf(
      svc('Bodega Valle Azul', 'activity', { time: '14:00', modality: 'shared', description: 'Visita a la bodega con degustación.', notes: 'Propinas', activity: ACTIVITY })
    );
    expect([bodega.time, bodega.modality]).toEqual(['14:00', 'Compartido']);
    expect(bodega.description).toBe('Visita a la bodega con degustación.');
    const facts = factsOf(bodega);
    expect(facts['Duración']).toBe('3 horas');
    expect(facts['Idioma']).toBe('Español');
    expect(facts['Incluye']).toBe('Degustación de 3 vinos y guía');
    expect(facts['No incluye']).toBe('Propinas');
  });

  it('traslado: ruta origen → destino y vehículo', () => {
    const [transfer] = previewOf(
      svc('Traslado', 'transfer', { transfer: { from: 'Aeropuerto', to: 'Hotel Faro', vehicle_type: 'Van 8 pax', passengers: null, baggage: null } })
    );
    expect(transfer.facts).toEqual([
      { label: 'Ruta', value: 'Aeropuerto → Hotel Faro' },
      { label: 'Vehículo', value: 'Van 8 pax' }
    ]);
  });

  it('un servicio sin más datos no muestra nada de más, y no inventa campos que el schema no trae', () => {
    const [plain] = previewOf(svc('Cena libre', 'other'));
    expect(plain.facts).toEqual([]);
    expect(plain.description).toBeNull();
  });

  it('la descripción se recorta para mantener la lista compacta', () => {
    const [long] = previewOf(svc('Paseo', 'activity', { description: 'palabra '.repeat(80) }));
    expect(long.description!.length).toBeLessThanOrEqual(220);
    expect(long.description!.endsWith('…')).toBe(true);
  });

  it('cena show (actividad) y asistencia al viajero («Otro») se ven con su tipo', () => {
    const [tango, plan] = previewOf(
      svc('Casa del Tango · cena show de tango', 'activity', { time: '19:30', modality: 'shared' }),
      svc('Asistencia al viajero · Titanium Plus', 'other')
    );
    expect(tango.typeLabel).toBe('Actividad');
    expect([tango.time, tango.modality]).toEqual(['19:30', 'Compartido']);
    expect(plan.typeLabel).toBe('Otro');
    expect(plan.name).toBe('Asistencia al viajero · Titanium Plus');
  });

  it('el aviso de privacidad y lo que falta de verdad llegan tal cual a la vista previa', () => {
    const p = buildPreview(
      extraction({
        warnings: [{ code: 'sensitive_data_removed', message: 'Algunos datos personales del documento no se incorporan a la propuesta.' }],
        missing: ['Datos de contacto del cliente (correo y teléfono).']
      })
    );
    expect(p.warnings).toEqual(['Algunos datos personales del documento no se incorporan a la propuesta.']);
    expect(p.missing).toEqual(['Datos de contacto del cliente (correo y teléfono).']);
  });
});

describe('vista previa: nunca muestra datos sensibles', () => {
  const PASSPORT = 'AB1234567';
  const TICKET = '123-4567890123';
  const BOOKING = 'XK4P9Q';

  it('redactSensitive quita boleto, pasaporte, localizador, asiento, nacimiento y tarjeta enmascarada', () => {
    for (const text of [
      `Boleto ${TICKET}`,
      `Pasaporte N° ${PASSPORT}`,
      `Localizador ${BOOKING}`,
      'Asiento 12A',
      'Fecha de nacimiento: 14/03/1985',
      'Tarjeta **** **** **** 1111'
    ]) {
      const clean = redactSensitive(text);
      for (const secret of [TICKET, PASSPORT, BOOKING, '12A', '14/03/1985', '1111']) {
        expect(clean).not.toContain(secret);
      }
    }
  });

  it('un consejo general sobre el pasaporte NO se toca, y un número de vuelo tampoco', () => {
    expect(redactSensitive('Lleve su pasaporte durante todo el viaje.')).toBe('Lleve su pasaporte durante todo el viaje.');
    expect(redactSensitive('Vuelo ZX 1627 a las 08:52')).toBe('Vuelo ZX 1627 a las 08:52');
  });

  it('aunque lo extraído traiga un dato sensible, ni el servicio, ni sus datos, ni las notas lo muestran', () => {
    const dirty = extraction({
      days: [
        {
          number: 1, date: null, base_city: null, title: `Salida ${PASSPORT}`, summary: null,
          services: [
            svc('Paseo en barco', 'activity', {
              description: `Salida del muelle. Asiento 12A. Localizador ${BOOKING}. Nacimiento: 14/03/1985.`,
              notes: `Boleto ${TICKET}`,
              activity: { ...ACTIVITY, included: `Guía. Pasaporte ${PASSPORT}` }
            }),
            svc(`Traslado ${PASSPORT}`, 'transfer', { transfer: { from: `Hotel (${TICKET})`, to: 'Puerto', vehicle_type: null, passengers: null, baggage: null } })
          ]
        }
      ],
      notes: [`Lleve su pasaporte. Pasaporte N° ${PASSPORT}.`, `Reserva ${TICKET}`],
      inclusions: [`Incluye boleto ${TICKET}`],
      exclusions: [],
      missing: [`Localizador ${BOOKING}`]
    });
    const shown = JSON.stringify(buildPreview(dirty));
    for (const secret of [PASSPORT, TICKET, BOOKING, '12A', '14/03/1985']) {
      expect(shown).not.toContain(secret);
    }
    // Lo demás sí se conserva.
    expect(shown).toContain('Salida del muelle');
    expect(shown).toContain('Lleve su pasaporte');
  });

  it('serviceFacts nunca incluye campos que el schema no tiene (localizador, asiento, boleto)', () => {
    const labels = serviceFacts(svc('Vuelo', 'flight', { flight: FLIGHT })).map((f) => f.label.toLowerCase());
    for (const banned of ['localizador', 'reserva', 'asiento', 'boleto', 'pasaporte', 'nacimiento']) {
      expect(labels.some((l) => l.includes(banned))).toBe(false);
    }
  });
});
