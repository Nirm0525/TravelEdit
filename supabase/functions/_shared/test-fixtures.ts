// Datos de ejemplo INVENTADOS para las pruebas (sin datos de clientes reales).
import type { Extraction, ExtractedService } from './proposal-extraction.ts';
import type { ProposalSnapshot } from './proposal-diff.ts';

export function service(partial: Partial<ExtractedService> & { name: string; type: ExtractedService['type'] }): ExtractedService {
  return {
    subtype: null,
    date: null,
    time: null,
    location: null,
    description: null,
    notes: null,
    modality: null,
    price: null,
    source_page: null,
    flight: null,
    hotel: null,
    transfer: null,
    activity: null,
    ...partial
  };
}

export function hotel(name: string, from: string, to: string, extra: Partial<NonNullable<ExtractedService['hotel']>> = {}): ExtractedService {
  return service({
    type: 'hotel',
    name,
    hotel: {
      check_in_date: from,
      check_out_date: to,
      check_in_time: null,
      check_out_time: null,
      room_type: null,
      meal_plan: null,
      category: null,
      address: null,
      guests: null,
      ...extra
    }
  });
}

export function flight(name: string, number: string, extra: Partial<NonNullable<ExtractedService['flight']>> = {}): ExtractedService {
  return service({
    type: 'flight',
    name,
    flight: {
      airline: null,
      flight_number: number,
      origin: null,
      destination: null,
      departure_time: null,
      arrival_time: null,
      arrival_date: null,
      cabin: null,
      baggage: null,
      ...extra
    }
  });
}

export function extraction(partial: Partial<Extraction> = {}): Extraction {
  return {
    client: { name: null, email: null, phone: null },
    travelers: { adults: null, children: null, children_ages: [] },
    trip: { title: null, start_date: null, end_date: null, destinations: [] },
    days: [],
    pricing: null,
    inclusions: [],
    exclusions: [],
    notes: [],
    missing: [],
    ...partial
  };
}

/** Propuesta de ejemplo: 2 días desde 2027-03-10. */
export function proposalSnapshot(overrides: Partial<ProposalSnapshot> = {}): ProposalSnapshot {
  return {
    updated_at: '2027-01-05T10:00:00Z',
    client_name: 'Familia Ejemplo',
    client_email: 'ejemplo@correo.test',
    client_phone: '+1 555 010 2030',
    start_date: '2027-03-10',
    end_date: '2027-03-12',
    travelers_count: 2,
    currency: 'USD',
    pricing_total: 3000,
    content: {
      days: [
        {
          id: 'day-1',
          dayNumber: 1,
          title: 'Llegada',
          location: 'Florencia',
          description: '',
          imagePath: null,
          services: [
            { id: 'svc-flight', type: 'flight', title: 'Vuelo a Florencia', time: '10:15', description: '', notes: '', imagePath: null, details: { flightNumber: 'IB579' } },
            {
              id: 'svc-hotel',
              type: 'hotel',
              title: 'Hotel Savoy',
              time: '',
              description: '',
              notes: '',
              imagePath: null,
              details: { checkInDate: '2027-03-10', checkOutDate: '2027-03-12', roomType: 'Suite' }
            },
            { id: 'svc-uffizi', type: 'activity', title: 'Visita a los Uffizi', time: '9:30 a. m.', description: '', notes: '', imagePath: null, details: { duration: '3 horas' } }
          ]
        },
        {
          id: 'day-2',
          dayNumber: 2,
          title: 'Toscana',
          location: 'Siena',
          description: '',
          imagePath: null,
          services: [{ id: 'svc-wine', type: 'activity', title: 'Cata de vinos', time: 'Tarde', description: '', notes: '', imagePath: null }]
        }
      ],
      pricing: {
        lines: [
          { id: 'line-hotel', label: 'Hotel Savoy', quantity: 2, unitPrice: 1000, serviceId: 'svc-hotel' },
          { id: 'line-tour', label: 'Cata de vinos', quantity: 2, unitPrice: 500 }
        ],
        feesLines: [{ id: 'fee-1', label: 'Tasa turística', quantity: 1, unitPrice: 0 }]
      }
    },
    ...overrides
  };
}

/** Extracción que coincide exactamente con proposalSnapshot(). */
export function matchingExtraction(): Extraction {
  return extraction({
    client: { name: 'Familia Ejemplo', email: 'EJEMPLO@correo.test', phone: '+1 (555) 010-2030' },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Toscana', start_date: '2027-03-10', end_date: '2027-03-12', destinations: ['Florencia'] },
    days: [
      {
        number: 1,
        date: '2027-03-10',
        base_city: 'Florencia',
        title: null,
        summary: null,
        services: [
          flight('Vuelo a Florencia', 'IB 579', { departure_time: '10:15' }),
          hotel('HOTEL SAVOY', '2027-03-10', '2027-03-12', { room_type: 'Suite' }),
          service({ type: 'activity', name: 'Visita a los Uffizí', time: '09:30', activity: { duration: '3 horas', meeting_point: null, participants: null, included: null, language: null } })
        ]
      },
      {
        number: 2,
        date: '2027-03-11',
        base_city: 'Siena',
        title: null,
        summary: null,
        services: [service({ type: 'activity', name: 'Cata de vinos' })]
      },
      { number: 3, date: '2027-03-12', base_city: 'Florencia', title: null, summary: null, services: [] }
    ],
    pricing: {
      currency: 'USD',
      total: 3000,
      other_currencies: [],
      lines: [
        { concept: 'Hotel Savoy', detail: null, amount: 2000, quantity: 2, unit_price: 1000, per_person: false, kind: 'service' },
        { concept: 'Cata de vinos', detail: null, amount: 1000, quantity: 2, unit_price: 500, per_person: false, kind: 'service' },
        { concept: 'Tasa turística', detail: null, amount: 0, quantity: 1, unit_price: 0, per_person: false, kind: 'fee' }
      ]
    }
  });
}
