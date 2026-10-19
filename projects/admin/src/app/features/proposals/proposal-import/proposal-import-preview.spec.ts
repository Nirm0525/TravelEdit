import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { buildPreview, formatDate, formatMoney, resolveLine } from './proposal-import-preview';

/** Extracción inventada (sin datos de clientes reales). */
function sample(over: Partial<StoredExtraction> = {}): StoredExtraction {
  const service = (name: string, type: 'flight' | 'hotel' | 'transfer' | 'activity' | 'other', extra: Record<string, unknown> = {}) =>
    ({
      type, subtype: null, name, date: null, time: null, location: null, description: null, notes: null, modality: null,
      price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null, ...extra
    }) as StoredExtraction['days'][number]['services'][number];

  return {
    client: { name: 'Persona Ejemplo', email: 'persona@ejemplo.test', phone: null },
    travelers: { adults: 2, children: 1, children_ages: [8] },
    trip: { title: 'Viaje de prueba', start_date: '2027-05-04', end_date: '2027-05-07', destinations: ['Isla Central', 'Puerto Azul'] },
    days: [
      {
        number: 1, date: '2027-05-04', base_city: 'Puerto Azul', title: null, summary: null,
        services: [
          service('Vuelo de ida', 'flight', { time: null, flight: { airline: null, flight_number: 'ZX 101', origin: null, destination: null, departure_time: '08:00', arrival_time: null, arrival_date: null, cabin: null, baggage: null } }),
          service('Traslado', 'transfer', { time: '11:00', modality: 'private' }),
          service('Cena de bienvenida', 'activity', { subtype: 'meal', modality: 'shared' }),
          service('Tren a la costa', 'transfer', { subtype: 'train' })
        ]
      },
      { number: 2, date: null, base_city: null, title: 'Día libre', summary: null, services: [] }
    ],
    pricing: {
      currency: 'USD',
      total: 2150,
      other_currencies: [],
      lines: [
        { concept: 'Paquete', detail: 'con desayuno', amount: 600, quantity: null, unit_price: null, per_person: true, kind: 'service' },
        { concept: 'Tasa turística', detail: null, amount: 50, quantity: 1, unit_price: 50, per_person: false, kind: 'fee' }
      ]
    },
    inclusions: ['Desayunos'],
    exclusions: ['Vuelos internacionales'],
    notes: ['Llevar abrigo'],
    missing: ['Teléfono del cliente'],
    warnings: [{ code: 'x', message: 'Un aviso de prueba.' }],
    meta: { model: 'm', extracted_at: '2027-01-01T00:00:00Z' },
    ...over
  };
}

describe('buildPreview', () => {
  it('cliente, viajeros, fechas y destino', () => {
    const p = buildPreview(sample());
    expect(p.clientName).toBe('Persona Ejemplo');
    expect(p.clientPhone).toBeNull();
    expect(p.travelers).toBe('2 adultos, 1 niño (8 años)');
    expect(p.dates).toContain('→');
    expect(p.destinations).toBe('Isla Central, Puerto Azul');
  });

  it('días y servicios: tipo, nombre, hora y modalidad; comida y tren con su propia etiqueta', () => {
    const p = buildPreview(sample());
    expect(p.days.map((d) => d.title)).toEqual(['Puerto Azul', 'Día libre']); // sin título → ciudad base
    expect(p.serviceCount).toBe(4);
    const [flight, transfer, meal, train] = p.days[0].services;
    expect([flight.typeLabel, flight.time]).toEqual(['Vuelo', '08:00']); // la hora de un vuelo es la de salida
    expect([transfer.typeLabel, transfer.time, transfer.modality]).toEqual(['Traslado', '11:00', 'Privado']);
    expect([meal.typeLabel, meal.modality]).toEqual(['Comida', 'Compartido']);
    expect(train.typeLabel).toBe('Tren');
  });

  it('inversión: "por persona" × viajeros (adultos + niños) y cargos aparte', () => {
    const { pricing } = buildPreview(sample());
    expect(pricing?.currency).toBe('USD');
    expect(pricing?.total).toBe(2150);
    expect(pricing?.lines.map((l) => [l.label, l.quantity, l.unitPrice, l.subtotal, l.kind])).toEqual([
      ['Paquete — con desayuno', 3, 600, 1800, 'service'],
      ['Tasa turística', 1, 50, 50, 'fee']
    ]);
  });

  it('sin precios: pricing null y sin servicios con precio → null ("el PDF no trae precios")', () => {
    expect(buildPreview(sample({ pricing: null })).pricing).toBeNull();
  });

  it('el price de un servicio solo cuenta si el PDF no trae pricing.lines', () => {
    const data = sample({ pricing: null });
    data.days[0].services[0].price = { amount: 300, per_person: false };
    const lines = buildPreview(data).pricing?.lines ?? [];
    expect(lines.map((l) => [l.label, l.subtotal])).toEqual([['Vuelo de ida', 300]]);

    const withLines = sample();
    withLines.days[0].services[0].price = { amount: 300, per_person: false };
    expect(buildPreview(withLines).pricing?.lines.length).toBe(2); // sin duplicar
  });

  it('avisos, faltantes y textos de solo lectura', () => {
    const p = buildPreview(sample());
    expect(p.warnings).toEqual(['Un aviso de prueba.']);
    expect(p.missing).toEqual(['Teléfono del cliente']);
    expect([p.inclusions, p.exclusions, p.notes]).toEqual([['Desayunos'], ['Vuelos internacionales'], ['Llevar abrigo']]);
  });

  it('un PDF casi vacío no rompe la vista previa', () => {
    const p = buildPreview(
      sample({
        client: { name: null, email: null, phone: null },
        travelers: { adults: null, children: null, children_ages: [] },
        trip: { title: null, start_date: null, end_date: null, destinations: [] },
        days: [], pricing: null, inclusions: [], exclusions: [], notes: [], missing: [], warnings: []
      })
    );
    expect([p.clientName, p.travelers, p.dates, p.destinations, p.pricing]).toEqual([null, null, null, null, null]);
    expect(p.days).toEqual([]);
  });
});

describe('resolveLine (misma regla que la creación real)', () => {
  it('quantity y unit_price se usan tal cual', () => {
    expect(resolveLine({ amount: 999, quantity: 2, unit_price: 50, per_person: true }, 4)).toEqual({ quantity: 2, unitPrice: 50 });
  });
  it('por persona × viajeros; sin viajeros o no por persona → cantidad 1', () => {
    expect(resolveLine({ amount: 100, quantity: null, unit_price: null, per_person: true }, 3)).toEqual({ quantity: 3, unitPrice: 100 });
    expect(resolveLine({ amount: 100, quantity: null, unit_price: null, per_person: true }, null)).toEqual({ quantity: 1, unitPrice: 100 });
    expect(resolveLine({ amount: 100, quantity: null, unit_price: null, per_person: false }, 3)).toEqual({ quantity: 1, unitPrice: 100 });
    expect(resolveLine({ amount: null, quantity: null, unit_price: null, per_person: false }, 3)).toEqual({ quantity: 1, unitPrice: 0 });
  });
});

describe('formato', () => {
  it('fechas ISO sin desfase de zona horaria', () => {
    expect(formatDate('2027-05-04')).toContain('4');
    expect(formatDate('2027-05-04')).toContain('2027');
    expect(formatDate(null)).toBeNull();
    expect(formatDate('no es fecha')).toBeNull();
  });
  it('montos con la moneda, y sin romper con una moneda inválida', () => {
    expect(formatMoney(1800, 'USD')).toContain('1');
    expect(formatMoney(1800, 'USD')).toContain('800');
    expect(() => formatMoney(10, 'XX')).not.toThrow();
    expect(formatMoney(10, null)).toContain('10');
  });
});
