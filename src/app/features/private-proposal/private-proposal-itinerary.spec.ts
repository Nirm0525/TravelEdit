import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { ProposalDocument, ProposalGateResponse, PublicProposalData, PublicProposalService, TravelKind } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';

const service = (id: string, title: string) => ({ id, type: 'hotel', title, description: `Descripción de ${title}`, notes: '', time: '', imagePath: null, details: {} });

/**
 * Contenido de un viaje CONTAMINADO con todo lo contractual: el servidor ya lo proyecta fuera para un itinerario, pero la pantalla
 * no debe pintarlo aunque llegara (segunda barrera).
 */
function data(kind: TravelKind, status: PublicProposalData['status']): PublicProposalData {
  return {
    kind,
    content: toProposalContent({
      cover: { title: 'Chile de punta a punta', subtitle: 'Un viaje inolvidable' },
      welcome: { body: '<p>Bienvenida personalizada</p>' },
      intro: { headline: 'Resumen del viaje', body: '<p>Texto del resumen</p>' },
      days: [{ id: 'd1', dayNumber: 1, title: 'Llegada a Santiago', location: 'Santiago', description: 'Descripción del día', imagePath: null, services: [service('s1', 'Hotel Faro')] }],
      pricing: { lines: [{ id: 'l1', label: 'Línea de precio secreta', quantity: 1, unitPrice: 98765 }], feesLines: [] },
      travelTips: [{ id: 'g1', destination: 'Santiago', tips: [{ id: 't1', title: 'Clima y equipaje', body: 'Lleva abrigo para la noche', category: 'weather' }] }],
      terms: { title: 'Condiciones secretas', body: '<p>TÉRMINOS CONTRACTUALES</p>' }
    }),
    pricingSubtotal: 98765, pricingFees: 0, pricingTotal: 98765, currency: 'USD', status, termsAccepted: true, acceptedAt: '2027-01-02T00:00:00Z',
    clientName: 'Persona Ejemplo', destinationText: 'Chile', startDate: '2027-05-04', endDate: '2027-05-07', travelersCount: 2,
    serviceChoices: { s1: true }, serviceComments: { s1: 'Cambien la fecha por favor' }
  };
}
const gate = (kind: TravelKind, over: Partial<ProposalGateResponse> = {}): ProposalGateResponse => ({
  kind, accessRequired: false, clientName: 'Persona Ejemplo', coverTitle: 'Chile de punta a punta', coverImagePath: null, status: kind === 'itinerary' ? 'shared' : 'published', ...over
});
const doc = (id: string, serviceId: string, name: string): ProposalDocument => ({ id, serviceId, name, mimeType: 'application/pdf' });

describe('PrivateProposal — vista privada de un ITINERARIO (y la de propuesta intacta)', { timeout: 20_000 }, () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments' | 'getDocumentUrl', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<PrivateProposal>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
    api = {
      getProposalGate: vi.fn(),
      verifyAccess: vi.fn().mockResolvedValue({ result: 'ok', sessionToken: SESSION, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      getContent: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue([]),
      getDocumentUrl: vi.fn().mockResolvedValue('https://signed.test/doc')
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
  });

  afterEach(() => {
    fixture?.destroy();
  });

  // El observador se deja instalado hasta el final del archivo: los temporizadores de la pantalla (scroll-spy) pueden dispararse
  // después de destruir el componente y no deben encontrar el global borrado.
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200)); // deja disparar los temporizadores pendientes (scroll-spy, animaciones)
    vi.unstubAllGlobals();
  });

  async function open(kind: TravelKind, status: PublicProposalData['status'], opts: { gate?: Partial<ProposalGateResponse>; docs?: ProposalDocument[] } = {}): Promise<void> {
    api.getProposalGate.mockResolvedValue(gate(kind, opts.gate));
    api.getContent.mockResolvedValue(data(kind, status));
    api.getDocuments.mockResolvedValue(opts.docs ?? []);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
  }

  // ---------------------------------------------------------------- itinerario
  it('itinerario compartido: muestra portada, bienvenida, resumen, fechas, viajeros, días, servicios y Travel Tips', async () => {
    await open('itinerary', 'shared');
    for (const wanted of ['Chile de punta a punta', 'Un viaje inolvidable', 'Bienvenida personalizada', 'Resumen del viaje', 'Texto del resumen', 'Llegada a Santiago', 'Hotel Faro', 'Descripción de Hotel Faro', 'Clima y equipaje', 'Lleva abrigo para la noche', 'Persona Ejemplo']) {
      expect(text(), wanted).toContain(wanted);
    }
    expect(el().querySelector('.proposal__hero-meta')?.textContent).toMatch(/2 viajeros/);
  });

  it('itinerario: NUNCA muestra precios, inversión, términos, aceptación, elecciones ni comentarios — aunque los datos los traigan', async () => {
    for (const status of ['shared', 'viewed'] as const) {
      await open('itinerary', status);
      for (const banned of [
        'Inversión', 'Línea de precio secreta', '98.765', '98,765', 'Ver detalle de costos',
        'Términos', 'Condiciones secretas', 'TÉRMINOS CONTRACTUALES',
        'Aceptar propuesta', 'Propuesta aceptada', 'Haz clic en aceptar', 'Nombre de quien acepta', 'Confirmo que he revisado', 'aceptada el',
        'Sí, por favor', 'Cambien la fecha por favor', 'Tu comentario', 'Solicitar cambios', 'dejar un comentario', 'Enviar comentarios a mi asesora'
      ]) {
        expect(text(), `${status}: ${banned}`).not.toContain(banned);
      }
      expect(el().querySelector('#inversion')).toBeNull();
      expect(el().querySelector('#terminos')).toBeNull();
      expect(el().querySelector('.proposal__accept-box')).toBeNull();
      expect(el().querySelector('.proposal__service-choice')).toBeNull();
      expect(el().querySelector('textarea')).toBeNull();
      expect(fixture.componentInstance.canChooseServices()).toBe(false);
      fixture.destroy();
    }
  });

  it('itinerario: no usa lenguaje de cotización ni de propuesta en ningún texto de la pantalla', async () => {
    await open('itinerary', 'viewed');
    expect(text().toLowerCase()).not.toContain('propuesta');
    expect(text().toLowerCase()).not.toContain('cotiz');
    expect(el().querySelector('.proposal__topbar-tag')?.textContent?.trim()).toBe('Itinerario privado');
    expect(text()).toContain('Tu itinerario ha sido preparado especialmente para ti');
  });

  it('itinerario: el menú ofrece solo Bienvenida, Resumen, Itinerario (con sus días) y Consejos', async () => {
    await open('itinerary', 'shared');
    const labels = fixture.componentInstance.navItems().map((i) => i.label);
    expect(labels).toEqual(['Bienvenida', 'Resumen', 'Itinerario', 'Día 01 – 4 may 2027', 'Consejos']);
    expect(el().querySelector('nav')?.getAttribute('aria-label')).toBe('Secciones del itinerario');
  });

  it('itinerario: los documentos visibles aparecen bajo su servicio (la misma función de documentos)', async () => {
    await open('itinerary', 'shared', { docs: [doc('doc-1', 's1', 'Boleto de entrada.pdf')] });
    expect(api.getDocuments).toHaveBeenCalledWith(TOKEN, SESSION);
    const docs = el().querySelector('app-proposal-service-documents')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(docs).toContain('Boleto de entrada');
    expect(el().innerHTML).not.toContain('storage_path');
  });

  it('itinerario: abrir un documento pide una URL firmada con token + sesión + id', async () => {
    await open('itinerary', 'shared', { docs: [doc('doc-1', 's1', 'Boleto.pdf')] });
    vi.spyOn(window, 'open').mockReturnValue({ opener: 'x', location: { href: '' }, close: vi.fn() } as unknown as Window);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.4', { status: 200 })));
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://app.test/x');
    await fixture.componentInstance.openDocument(doc('doc-1', 's1', 'Boleto.pdf'));
    expect(api.getDocumentUrl).toHaveBeenCalledWith(TOKEN, SESSION, 'doc-1');
  });

  // ---------------------------------------------------------------- acceso
  it('pantalla de acceso de un itinerario: textos propios y el código funciona', async () => {
    api.getProposalGate.mockResolvedValue(gate('itinerary', { accessRequired: true }));
    api.verifyAccess.mockResolvedValueOnce({ result: 'invalid_code', sessionToken: null, sessionExpiresAt: null }); // sonda silenciosa
    api.getContent.mockResolvedValue(data('itinerary', 'shared'));
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(text()).toContain('Ingresa para ver tu itinerario de viaje');
    expect(text()).toContain('Este itinerario es privado y personal.');
    expect(el().querySelector('.private-proposal__gate-proposal-title')?.textContent?.trim()).toBe('Itinerario');
    expect(text()).not.toContain('propuesta');
    // Código incorrecto → error; código correcto → contenido.
    api.verifyAccess.mockResolvedValueOnce({ result: 'invalid_code', sessionToken: null, sessionExpiresAt: null });
    fixture.componentInstance.codeInput.set('MALO');
    await fixture.componentInstance.submitCode();
    await settle();
    expect(fixture.componentInstance.accessError()).toBe('invalid_code');
    expect(text()).toContain('Código incorrecto');
    api.verifyAccess.mockResolvedValueOnce({ result: 'ok', sessionToken: SESSION, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() });
    fixture.componentInstance.codeInput.set('TRV-BUENO');
    await fixture.componentInstance.submitCode();
    await settle();
    expect(api.verifyAccess).toHaveBeenLastCalledWith(TOKEN, 'TRV-BUENO');
    expect(text()).toContain('Chile de punta a punta');
  });

  it('un acceso vencido de un itinerario lo dice con su propio texto (sin código)', async () => {
    api.getProposalGate.mockResolvedValue(gate('itinerary', { status: 'expired', accessRequired: true }));
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(text()).toContain('Tu acceso a este itinerario venció');
    expect(el().querySelector('#gate-access-code')).toBeNull();
    expect(api.getContent).not.toHaveBeenCalled();
  });

  it('un enlace sin gate (borrador, sin compartir, vencido o inexistente) NO entrega nada y no dice «propuesta» ni «itinerario»', async () => {
    api.getProposalGate.mockResolvedValue(null);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(text()).toContain('Este enlace no está disponible');
    expect(text().toLowerCase()).not.toContain('propuesta');
    expect(text().toLowerCase()).not.toContain('itinerario');
    expect(api.verifyAccess).not.toHaveBeenCalled();
    expect(api.getContent).not.toHaveBeenCalled();
    expect(api.getDocuments).not.toHaveBeenCalled();
  });

  it('si el contenido se pide con una sesión revocada (unshare) la pantalla no muestra nada', async () => {
    sessionStorage.setItem(`te-proposal-session:${TOKEN}`, JSON.stringify({ sessionToken: SESSION, expiresAt: new Date(Date.now() + 3600_000).toISOString() }));
    api.getProposalGate.mockResolvedValue(gate('itinerary'));
    api.getContent.mockRejectedValue(new Error('session_invalid'));
    api.verifyAccess.mockResolvedValue({ result: 'not_found', sessionToken: null, sessionExpiresAt: null });
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(text()).not.toContain('Hotel Faro');
    expect(text()).not.toContain('Chile de punta a punta Un viaje inolvidable');
  });

  // ---------------------------------------------------------------- propuesta: intacta
  it('PROPUESTA (regresión): conserva inversión, términos, aceptar, «Sí, por favor» y sus textos', async () => {
    await open('proposal', 'published');
    for (const wanted of ['Inversión', 'Condiciones secretas', 'Aceptar propuesta', 'Sí, por favor', 'Propuesta privada', 'Tu propuesta ha sido creada especialmente para ti']) {
      expect(text(), wanted).toContain(wanted);
    }
    expect(fixture.componentInstance.canChooseServices()).toBe(true);
    expect(fixture.componentInstance.navItems().map((i) => i.label)).toEqual(
      ['Bienvenida', 'Resumen', 'Itinerario', 'Día 01 – 4 may 2027', 'Consejos', 'Inversión', 'Términos', 'Aceptar propuesta']
    );
  });

  it('PROPUESTA (regresión): pantalla de acceso con sus textos de siempre', async () => {
    api.getProposalGate.mockResolvedValue(gate('proposal', { accessRequired: true }));
    api.verifyAccess.mockResolvedValue({ result: 'invalid_code', sessionToken: null, sessionExpiresAt: null });
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(text()).toContain('Ingresa para ver tu propuesta de viaje');
    expect(text()).toContain('Ver mi propuesta');
    expect(text()).toContain('Esta propuesta es privada y personal.');
    expect(el().querySelector('.private-proposal__gate-proposal-title')?.textContent?.trim()).toBe('Propuesta');
  });

  it('PROPUESTA aceptada (regresión): muestra «Propuesta aceptada» y no ofrece elegir servicios', async () => {
    await open('proposal', 'accepted');
    expect(text()).toContain('Propuesta aceptada');
    expect(fixture.componentInstance.canChooseServices()).toBe(false);
  });

  it('una respuesta sin kind (base anterior a 0055) se trata como propuesta', async () => {
    api.getProposalGate.mockResolvedValue({ accessRequired: false, clientName: 'P', coverTitle: 'T', coverImagePath: null, status: 'published' });
    const legacy = data('proposal', 'published');
    delete legacy.kind;
    api.getContent.mockResolvedValue(legacy);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    expect(fixture.componentInstance.isItinerary()).toBe(false);
    expect(text()).toContain('Aceptar propuesta');
  });
});
