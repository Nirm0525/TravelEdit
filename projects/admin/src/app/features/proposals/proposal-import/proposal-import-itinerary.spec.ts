import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalImport } from './proposal-import';
import { buildPreview } from './proposal-import-preview';
import { ImportStatusRow, ProposalImportService } from '../../../core/services/proposal-import';
import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { TravelMode } from '../../travel/travel-config';

/** Extracción de una COTIZACIÓN: trae precios, condiciones e inclusiones que un itinerario no debe mostrar ni importar. */
function quote(over: Partial<StoredExtraction> = {}): StoredExtraction {
  return {
    client: { name: 'Persona Ejemplo', email: null, phone: null },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Viaje de prueba', start_date: '2027-05-04', end_date: '2027-05-07', destinations: ['Isla Central'] },
    days: [
      {
        number: 1, date: '2027-05-04', base_city: 'Isla Central', title: 'Llegada', summary: 'Resumen del primer día.',
        services: [
          { type: 'hotel', subtype: null, name: 'Hotel Faro', date: null, time: null, location: null, description: null, notes: null, modality: null, price: { amount: 777, per_person: false }, source_page: null, flight: null, hotel: null, transfer: null, activity: null },
          { type: 'transfer', subtype: null, name: 'Traslado', date: null, time: '11:00', location: null, description: null, notes: null, modality: 'private', price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null }
        ]
      }
    ],
    pricing: { currency: 'USD', total: 2000, other_currencies: [], lines: [{ concept: 'Paquete', detail: null, amount: 2000, quantity: 1, unit_price: 2000, per_person: false, kind: 'service' }] },
    inclusions: ['Desayunos incluidos'], exclusions: ['Propinas no incluidas'], notes: ['Lleve abrigo.'], missing: ['Teléfono del cliente', 'Precios no encontrados'],
    warnings: [{ code: 'days_merged', message: 'Se unió un día.' }, { code: 'price_total_mismatch', message: 'El total no coincide.' }],
    meta: { model: 'm', extracted_at: '2027-01-01T00:00:00Z' },
    ...over
  };
}

const row = (over: Partial<ImportStatusRow> = {}): ImportStatusRow => ({ id: 'imp-1', status: 'ready', error: null, extracted: quote(), proposal_id: null, kind: 'itinerary', ...over });

describe('buildPreview por tipo', () => {
  it('propuesta (por defecto): muestra precios, inclusiones y exclusiones como siempre', () => {
    const p = buildPreview(quote());
    expect(p.pricing?.lines.length).toBe(1);
    expect(p.inclusions).toEqual(['Desayunos incluidos']);
    expect(p.exclusions).toEqual(['Propinas no incluidas']);
    expect(p.warnings).toContain('El total no coincide.');
  });

  it('itinerario: SOLO contenido operativo — sin precios, inclusiones, exclusiones, avisos de precios ni faltantes comerciales', () => {
    const p = buildPreview(quote(), 'itinerary');
    expect(p.pricing).toBeNull();
    expect([p.inclusions, p.exclusions]).toEqual([[], []]);
    expect(p.warnings).toEqual(['Se unió un día.']);
    expect(p.missing).toEqual(['Teléfono del cliente']);
    expect(p.days.length).toBe(1);
    expect(p.days[0].services.map((s) => s.name)).toEqual(['Hotel Faro', 'Traslado']);
    expect(p.notes).toEqual(['Lleve abrigo.']);
    expect(JSON.stringify(p)).not.toMatch(/777|2000|Paquete|Desayunos|Propinas/);
  });
});

describe('ProposalImport en modo itinerario ("Nuevo desde PDF")', () => {
  let service: Record<'upload' | 'start' | 'getStatus' | 'apply' | 'listLeads', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<ProposalImport>;
  let navigate: ReturnType<typeof vi.spyOn>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const button = (label: string) => Array.from(el().querySelectorAll('button, a')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;
  const pdf = () => new File([new Uint8Array(1000)], 'viaje.pdf', { type: 'application/pdf' });

  async function create(mode: TravelMode, status: ImportStatusRow = row({ kind: mode })): Promise<void> {
    service = {
      upload: vi.fn().mockResolvedValue('imp-1'),
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue(status),
      apply: vi.fn().mockResolvedValue('new-9'),
      listLeads: vi.fn().mockResolvedValue([{ id: 'lead-1', name: 'Lead Demo', email: null }])
    };
    await TestBed.configureTestingModule({
      imports: [ProposalImport],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { mode } } } },
        { provide: ProposalImportService, useValue: service }
      ]
    }).compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProposalImport);
    fixture.detectChanges();
    await settle();
  }

  async function runToPreview(): Promise<void> {
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [pdf()], configurable: true });
    input.dispatchEvent(new Event('change'));
    const channel = el().querySelectorAll('select')[0] as HTMLSelectElement;
    channel.value = 'whatsapp';
    channel.dispatchEvent(new Event('change'));
    await settle();
    button('Continuar')!.click();
    await settle();
  }

  it('textos del itinerario: título, migas y botón de crear', async () => {
    await create('itinerary');
    expect(text()).toContain('Nuevo itinerario desde PDF');
    expect(text()).toContain('Itinerarios');
    expect(text()).not.toContain('Nueva propuesta desde PDF');
    await runToPreview();
    expect(button('Crear itinerario en borrador')).toBeDefined();
    expect(text()).not.toContain('Crear propuesta');
  });

  it('el formulario no ofrece vincular una solicitud y ni siquiera las consulta', async () => {
    await create('itinerary');
    expect(text()).not.toContain('Vincular a una solicitud');
    expect(service.listLeads).not.toHaveBeenCalled();
  });

  it('sube con kind = itinerary (una sola vez, al subir) y lo lee del servidor: start y apply no mandan el tipo', async () => {
    await create('itinerary');
    await runToPreview();
    expect(service.upload.mock.calls[0][1]).toBe('itinerary');
    expect(service.start).toHaveBeenCalledWith('imp-1');
    button('Crear itinerario en borrador')!.click();
    await settle();
    expect(service.apply).toHaveBeenCalledWith('imp-1', 'whatsapp', null);
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'new-9', 'edit']);
  });

  it('la vista previa muestra solo contenido operativo: cliente, días, servicios y notas; nada de precios ni condiciones', async () => {
    await create('itinerary');
    await runToPreview();
    for (const wanted of ['Persona Ejemplo', 'Hotel Faro', 'Traslado', 'Resumen del primer día.', 'Lleve abrigo.', 'Se unió un día.']) {
      expect(text(), wanted).toContain(wanted);
    }
    for (const banned of ['Inversión', 'Total del PDF', 'Paquete', '2.000', '777', 'Incluye', 'No incluye', 'Inclusiones', 'Propinas', 'Desayunos', 'El total no coincide', 'Precios no encontrados', 'agrégalas en el constructor']) {
      expect(text(), banned).not.toContain(banned);
    }
  });

  it('un itinerario no se vincula a solicitudes aunque el estado trajera una', async () => {
    await create('itinerary');
    await runToPreview();
    button('Crear itinerario en borrador')!.click();
    await settle();
    expect(service.apply.mock.calls[0][2]).toBeNull();
  });

  it('si la fila resulta ser de OTRO tipo, no se muestra ni se aplica nada', async () => {
    await create('itinerary', row({ kind: 'proposal' }));
    await runToPreview();
    expect(text()).toContain('Esta importación es de otro tipo');
    expect(text()).not.toContain('Hotel Faro');
    expect(button('Crear itinerario en borrador')).toBeUndefined();
    expect(service.apply).not.toHaveBeenCalled();
  });

  it('una importación ya aplicada abre el editor de itinerarios', async () => {
    await create('itinerary', row({ kind: 'itinerary', status: 'applied', proposal_id: 'done-1', extracted: null }));
    await runToPreview();
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'done-1', 'edit']);
  });

  it('PROPUESTA (regresión): sube con kind = proposal, ofrece solicitudes, muestra inversión e inclusiones y abre propuestas', async () => {
    await create('proposal');
    expect(text()).toContain('Nueva propuesta desde PDF');
    expect(text()).toContain('Vincular a una solicitud');
    await runToPreview();
    expect(service.upload.mock.calls[0][1]).toBe('proposal');
    for (const wanted of ['Inversión', 'Paquete', 'Desayunos incluidos', 'Propinas no incluidas', 'Crear propuesta en borrador']) {
      expect(text(), wanted).toContain(wanted);
    }
    button('Crear propuesta en borrador')!.click();
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'new-9', 'edit']);
  });
});
