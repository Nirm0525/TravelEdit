import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { ProposalGateResponse, PublicProposalData, PublicProposalService, TravelKind } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';
const service = { id: 's1', type: 'hotel', title: 'Hotel Faro', description: 'Descripción del hotel', notes: '', time: '', imagePath: null, details: {} };
const baseDay = { imagePath: null, location: '', description: '', services: [service] };

function data(kind: TravelKind, days: unknown[]): PublicProposalData {
  return {
    kind,
    content: toProposalContent({ cover: { title: 'Londres' }, days }),
    pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: kind === 'itinerary' ? 'shared' : 'published',
    termsAccepted: false, acceptedAt: null, clientName: 'Persona Ejemplo', destinationText: 'Londres', startDate: null, endDate: null,
    travelersCount: 2, serviceChoices: {}, serviceComments: {}
  };
}

describe('PrivateProposal — recomendaciones del día', { timeout: 20_000 }, () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments' | 'getDocumentUrl', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<PrivateProposal>;
  const el = () => fixture.nativeElement as HTMLElement;
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
      getDocumentUrl: vi.fn()
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
  });
  afterEach(() => fixture?.destroy());
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    vi.unstubAllGlobals();
  });

  async function open(kind: TravelKind, days: unknown[]): Promise<void> {
    const gate: ProposalGateResponse = { kind, accessRequired: false, clientName: 'Persona Ejemplo', coverTitle: 'Londres', coverImagePath: null, status: kind === 'itinerary' ? 'shared' : 'published' };
    api.getProposalGate.mockResolvedValue(gate);
    api.getContent.mockResolvedValue(data(kind, days));
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
  }

  for (const kind of ['itinerary', 'proposal'] as const) {
    it(`${kind}: titular + texto al FINAL del día, después de los servicios, respetando el formato`, async () => {
      await open(kind, [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'Llegada', recommendations: { headline: 'Recomendaciones para tu visita a Londres', body: '<p>Lleva <strong>paraguas</strong></p><ul><li>Abrigo</li></ul>' } }]);
      const block = el().querySelector('.proposal__day app-day-recommendations')!;
      expect(block).toBeTruthy();
      expect(block.textContent).toContain('Recomendaciones para tu visita a Londres');
      expect(block.querySelector('strong')?.textContent).toBe('paraguas');
      expect(block.querySelectorAll('li').length).toBe(1);
      const services = el().querySelector('.proposal__day .proposal__services')!;
      expect(services.compareDocumentPosition(block) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }

  it('solo texto: el encabezado es «Recomendaciones del día»', async () => {
    await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'Llegada', recommendations: { headline: '', body: '<p>Puntualidad en el punto de encuentro</p>' } }]);
    expect(el().querySelector('app-day-recommendations h4')?.textContent?.trim()).toBe('Recomendaciones del día');
    expect(el().querySelector('app-day-recommendations')?.textContent).toContain('Puntualidad en el punto de encuentro');
  });

  it('solo titular: se muestra el titular sin cuerpo vacío', async () => {
    await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'Llegada', recommendations: { headline: 'Solo titular', body: '' } }]);
    expect(el().querySelector('app-day-recommendations h4')?.textContent?.trim()).toBe('Solo titular');
    expect(el().querySelector('.day-recs__body')).toBeNull();
  });

  it('sin contenido (día viejo, objeto vacío o <p></p>) no hay bloque', async () => {
    await open('itinerary', [
      { ...baseDay, id: 'd1', dayNumber: 1, title: 'A' },
      { ...baseDay, id: 'd2', dayNumber: 2, title: 'B', recommendations: { headline: '  ', body: '<p></p>' } },
      { ...baseDay, id: 'd3', dayNumber: 3, title: 'C', recommendations: { headline: '', body: '' } }
    ]);
    expect(el().querySelectorAll('.proposal__day').length).toBe(3);
    expect(el().querySelector('app-day-recommendations')).toBeNull();
  });

  it('cada día muestra las suyas y el HTML peligroso se sanea', async () => {
    await open('itinerary', [
      { ...baseDay, id: 'd1', dayNumber: 1, title: 'A', recommendations: { headline: 'Uno', body: '<p>Texto uno</p><script>window.__pwned=1</script><img src=x onerror="window.__pwned=1">' } },
      { ...baseDay, id: 'd2', dayNumber: 2, title: 'B', recommendations: { headline: 'Dos', body: '<p>Texto dos</p>' } }
    ]);
    const blocks = Array.from(el().querySelectorAll('app-day-recommendations'));
    expect(blocks.length).toBe(2);
    expect(blocks[0].textContent).toContain('Texto uno');
    expect(blocks[1].textContent).toContain('Texto dos');
    expect(blocks[0].querySelector('script')).toBeNull();
    expect(blocks[0].querySelector('[onerror]')).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});
