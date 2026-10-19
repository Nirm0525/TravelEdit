import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalImport } from './proposal-import';
import { ImportStatusRow, ProposalImportService } from '../../../core/services/proposal-import';
import { StoredExtraction } from '../../../core/models/proposal-extraction.types';

/** Extracción inventada mínima (sin datos de clientes). */
function extraction(over: Partial<StoredExtraction> = {}): StoredExtraction {
  return {
    client: { name: 'Persona Ejemplo', email: null, phone: null },
    travelers: { adults: 2, children: 0, children_ages: [] },
    trip: { title: 'Viaje de prueba', start_date: '2027-05-04', end_date: '2027-05-07', destinations: ['Isla Central'] },
    days: [
      {
        number: 1, date: '2027-05-04', base_city: 'Isla Central', title: 'Llegada', summary: null,
        services: [
          { type: 'hotel', subtype: null, name: 'Hotel Faro', date: null, time: null, location: null, description: null, notes: null, modality: null, price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null },
          { type: 'transfer', subtype: null, name: 'Traslado', date: null, time: '11:00', location: null, description: null, notes: null, modality: 'private', price: null, source_page: null, flight: null, hotel: null, transfer: null, activity: null }
        ]
      }
    ],
    pricing: { currency: 'USD', total: 2000, other_currencies: [], lines: [{ concept: 'Paquete', detail: null, amount: 2000, quantity: 1, unit_price: 2000, per_person: false, kind: 'service' }] },
    inclusions: ['Desayunos'], exclusions: [], notes: [], missing: ['Teléfono del cliente'],
    warnings: [{ code: 'x', message: 'Un aviso de prueba.' }],
    meta: { model: 'm', extracted_at: '2027-01-01T00:00:00Z' },
    ...over
  };
}

const row = (over: Partial<ImportStatusRow> = {}): ImportStatusRow => ({ id: 'imp-1', status: 'ready', error: null, extracted: extraction(), proposal_id: null, ...over });

describe('ProposalImport (pantalla "Nueva desde PDF")', () => {
  let service: { upload: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; getStatus: ReturnType<typeof vi.fn>; apply: ReturnType<typeof vi.fn>; listLeads: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ProposalImport>;
  let router: Router;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const button = (label: string) => Array.from(el().querySelectorAll('button, a')).find((b) => b.textContent?.includes(label)) as HTMLButtonElement | undefined;

  function pick(file: File): void {
    const input = el().querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }
  function choose(selector: string, value: string): void {
    const select = el().querySelector(selector) as HTMLSelectElement;
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  const channelSelect = () => el().querySelectorAll('select')[0] as HTMLSelectElement;
  const pdf = (name = 'viaje.pdf', size = 1000) => new File([new Uint8Array(size)], name, { type: 'application/pdf' });

  beforeEach(async () => {
    service = {
      upload: vi.fn().mockResolvedValue('imp-1'),
      start: vi.fn().mockResolvedValue(undefined),
      getStatus: vi.fn().mockResolvedValue(row()),
      apply: vi.fn().mockResolvedValue('prop-9'),
      listLeads: vi.fn().mockResolvedValue([{ id: 'lead-1', name: 'Lead Demo', email: 'lead@ejemplo.test' }])
    };
    await TestBed.configureTestingModule({
      imports: [ProposalImport],
      providers: [provideRouter([]), { provide: ProposalImportService, useValue: service }]
    }).compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProposalImport);
    fixture.detectChanges();
    await settle();
  });

  it('empieza en el formulario con "Continuar" desactivado', () => {
    expect(text()).toContain('Arrastra el PDF aquí');
    expect(button('Continuar')?.disabled).toBe(true);
  });

  it('rechaza lo que no es PDF y lo que pesa más de 20 MB, con mensaje claro', async () => {
    pick(new File(['x'], 'foto.png', { type: 'image/png' }));
    await settle();
    expect(text()).toContain('Solo se aceptan archivos PDF');
    expect(button('Continuar')?.disabled).toBe(true);

    pick(new File([new Uint8Array(21 * 1024 * 1024)], 'grande.pdf', { type: 'application/pdf' }));
    await settle();
    expect(text()).toContain('el máximo es 20 MB');
    expect(service.upload).not.toHaveBeenCalled();
  });

  it('pide elegir el canal: con archivo válido pero sin canal sigue desactivado', async () => {
    pick(pdf());
    await settle();
    expect(text()).toContain('viaje.pdf');
    expect(button('Continuar')?.disabled).toBe(true);
    choose('select', 'whatsapp');
    await settle();
    expect(button('Continuar')?.disabled).toBe(false);
  });

  it('con una solicitud vinculada el canal queda en "Sitio web" y no se puede cambiar', async () => {
    choose('select', 'email');
    choose('select:nth-of-type(1)', 'email');
    const leadSelect = el().querySelectorAll('select')[1] as HTMLSelectElement;
    leadSelect.value = 'lead-1';
    leadSelect.dispatchEvent(new Event('change'));
    await settle();
    expect(channelSelect().disabled).toBe(true);
    expect(channelSelect().value).toBe('web');
    expect(text()).toContain('el canal es siempre «Sitio web»');
  });

  it('flujo completo: sube, lee, muestra la vista previa y crea la propuesta abriendo el constructor', async () => {
    pick(pdf('mi viaje.pdf'));
    choose('select', 'whatsapp');
    await settle();

    button('Continuar')!.click();
    await settle();

    expect(service.upload).toHaveBeenCalledTimes(1);
    expect(service.start).toHaveBeenCalledWith('imp-1');
    // Vista previa
    expect(text()).toContain('Persona Ejemplo');
    expect(text()).toContain('Hotel Faro');
    expect(text()).toContain('Privado'); // modalidad del traslado
    expect(text()).toContain('Paquete');
    expect(text()).toContain('Un aviso de prueba.');
    expect(text()).toContain('Teléfono del cliente');
    expect(text()).toContain('esto no se copia a la propuesta');

    button('Crear propuesta en borrador')!.click();
    await settle();

    expect(service.apply).toHaveBeenCalledWith('imp-1', 'whatsapp', null);
    expect(router.navigate).toHaveBeenCalledWith(['/proposals', 'prop-9', 'edit']);
  });

  it('con solicitud vinculada, crea con canal "web" y el lead', async () => {
    pick(pdf());
    const leadSelect = el().querySelectorAll('select')[1] as HTMLSelectElement;
    leadSelect.value = 'lead-1';
    leadSelect.dispatchEvent(new Event('change'));
    await settle();
    button('Continuar')!.click();
    await settle();
    button('Crear propuesta en borrador')!.click();
    await settle();
    expect(service.apply).toHaveBeenCalledWith('imp-1', 'web', 'lead-1');
  });

  it('sin precios en el PDF: avisa que se agregan en el constructor', async () => {
    service.getStatus.mockResolvedValue(row({ extracted: extraction({ pricing: null }) }));
    pick(pdf());
    choose('select', 'other');
    await settle();
    button('Continuar')!.click();
    await settle();
    expect(text()).toContain('El PDF no trae precios: agrégalos en el constructor.');
  });

  it('si la lectura falla muestra el mensaje de la fila y "Intentar de nuevo" vuelve a pedirla', async () => {
    service.getStatus.mockResolvedValueOnce(row({ status: 'failed', error: 'El archivo no es un PDF válido.', extracted: null }));
    pick(pdf());
    choose('select', 'phone');
    await settle();
    button('Continuar')!.click();
    await settle();

    expect(text()).toContain('El archivo no es un PDF válido.');
    expect(button('Intentar de nuevo')).toBeTruthy();

    service.getStatus.mockResolvedValue(row());
    button('Intentar de nuevo')!.click();
    await settle();

    expect(service.start).toHaveBeenCalledTimes(2);
    expect(service.upload).toHaveBeenCalledTimes(1); // no vuelve a subir el archivo
    expect(text()).toContain('Persona Ejemplo');
  });

  it('si no se puede subir el archivo muestra el error y permite reintentar desde cero', async () => {
    service.upload.mockRejectedValueOnce(new Error('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.'));
    pick(pdf());
    choose('select', 'email');
    await settle();
    button('Continuar')!.click();
    await settle();
    expect(text()).toContain('No se pudo subir el archivo');

    button('Intentar de nuevo')!.click();
    await settle();
    expect(service.upload).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Persona Ejemplo');
  });

  it('si crear la propuesta falla, muestra el motivo y no navega', async () => {
    service.apply.mockRejectedValueOnce(new Error('Esta importación ya se aplicó en otra pestaña.'));
    pick(pdf());
    choose('select', 'referral');
    await settle();
    button('Continuar')!.click();
    await settle();
    button('Crear propuesta en borrador')!.click();
    await settle();
    expect(text()).toContain('ya se aplicó en otra pestaña');
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('el nombre original del archivo solo se muestra: no se envía al servicio como ruta', async () => {
    pick(pdf('../../etc/passwd.pdf'));
    choose('select', 'other');
    await settle();
    button('Continuar')!.click();
    await settle();
    const uploaded = service.upload.mock.calls[0][0] as File;
    expect(uploaded.name).toBe('../../etc/passwd.pdf'); // el servicio decide la ruta (<uid>/<uuid>.pdf), ver pdf-import.spec
  });
});
