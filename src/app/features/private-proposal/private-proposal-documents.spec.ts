import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { ProposalDocument, PublicProposalData, PublicProposalService } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';

const service = (id: string, title: string) => ({ id, type: 'flight', title, description: `Descripción de ${title}`, notes: '', time: '', imagePath: null, details: {} });

function data(): PublicProposalData {
  return {
    content: toProposalContent({
      cover: { title: 'Viaje de prueba' },
      days: [{ id: 'd1', dayNumber: 1, title: 'Llegada', location: '', description: '', imagePath: null, services: [service('s1', 'Vuelo CM385'), service('s2', 'Hotel Faro')] }]
    }),
    pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: 'published', termsAccepted: false, acceptedAt: null,
    clientName: 'Persona Ejemplo', destinationText: null, startDate: '2027-05-04', endDate: '2027-05-07', travelersCount: 2, serviceChoices: {}, serviceComments: {}
  };
}
const doc = (id: string, serviceId: string, name: string): ProposalDocument => ({ id, serviceId, name, mimeType: 'application/pdf' });

describe('PrivateProposal — documentos por servicio', () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments' | 'getDocumentUrl', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<PrivateProposal>;

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const serviceCards = () => Array.from(el().querySelectorAll('app-proposal-service-documents'));

  async function create(documents: ProposalDocument[]): Promise<void> {
    api.getDocuments.mockResolvedValue(documents);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    // Los servicios se pintan al expandir el itinerario completo.
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
  }

  beforeEach(() => {
    api = {
      getProposalGate: vi.fn().mockResolvedValue({ accessRequired: false, clientName: 'Persona Ejemplo', coverTitle: 'Viaje', coverImagePath: null, status: 'published' }),
      verifyAccess: vi.fn().mockResolvedValue({ result: 'ok', sessionToken: SESSION, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      getContent: vi.fn().mockResolvedValue(data()),
      getDocuments: vi.fn(),
      getDocumentUrl: vi.fn().mockResolvedValue('https://signed.test/doc?token=abc')
    };
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }]
    });
    sessionStorage.clear();
    // jsdom no trae estos observadores: la propuesta los usa para el índice y las animaciones de scroll.
    const observer = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] {
        return [];
      }
    };
    vi.stubGlobal('IntersectionObserver', observer);
    vi.stubGlobal('ResizeObserver', observer);
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('pide los documentos con el token de la URL y la sesión emitida por el servidor', async () => {
    await create([]);
    expect(api.getDocuments).toHaveBeenCalledWith(TOKEN, SESSION);
  });

  it('sin documentos visibles NO aparece ninguna sección «Documentos» en ningún servicio', async () => {
    await create([]);
    expect(serviceCards().length).toBe(2);
    expect(el().querySelector('.proposal-docs')).toBeNull();
    expect(el().textContent).not.toContain('Ver documento');
  });

  it('muestra «Documentos» solo bajo el servicio que los tiene, con «Ver documento →»', async () => {
    await create([doc('x1', 's1', 'Boleto aéreo CM385.pdf')]);
    const sections = Array.from(el().querySelectorAll('.proposal-docs'));
    expect(sections.length).toBe(1);
    expect(sections[0].textContent).toContain('Boleto aéreo CM385');
    expect(sections[0].textContent).toContain('Ver documento →');
    // Está dentro del servicio s1 (el del vuelo) y no del hotel.
    const holder = sections[0].closest('li, article, div[id], .proposal__service') as HTMLElement | null;
    expect(holder?.textContent).toContain('Vuelo CM385');
    expect(holder?.textContent).not.toContain('Hotel Faro');
  });

  it('el HTML del cliente no lleva rutas de Storage, ids internos ni metadata', async () => {
    await create([doc('11111111-2222-4333-8444-555555555555', 's1', 'Boleto.pdf')]);
    const html = el().querySelector('.proposal-docs')!.outerHTML;
    for (const forbidden of ['11111111-2222', 'storage', 'visible_to_client', 'application/pdf', 'href', 'http']) {
      expect(html).not.toContain(forbidden);
    }
  });

  it('abrir: pide una URL firmada al hacer clic (token + sesión + id) y la abre en la pestaña ya abierta', async () => {
    const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await create([doc('x1', 's1', 'Boleto.pdf')]);
    (el().querySelector('.proposal-docs__link') as HTMLButtonElement).click();
    await settle();
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(api.getDocumentUrl).toHaveBeenCalledWith(TOKEN, SESSION, 'x1');
    expect(tab.location.href).toBe('https://signed.test/doc?token=abc');
    expect(tab.opener).toBeNull();
  });

  it('abrir: si no se puede obtener la URL (404) se cierra la pestaña y se avisa sin detalles técnicos', async () => {
    const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    await create([doc('x1', 's1', 'Boleto.pdf')]);
    api.getDocumentUrl.mockRejectedValueOnce(new Error('No se pudo abrir el documento.'));
    (el().querySelector('.proposal-docs__link') as HTMLButtonElement).click();
    await settle();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe('');
    expect(el().textContent).toContain('No pudimos abrir el documento');
  });
});
