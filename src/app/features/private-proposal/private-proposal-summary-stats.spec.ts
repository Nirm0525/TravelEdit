import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { PROPOSAL_SESSION_PREFIX, PublicProposalData, PublicProposalService } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '36363636-3636-4636-8636-363636363636';
const SESSION = '46464646-4646-4646-8646-464646464646';

const itinerary = (stats?: unknown): PublicProposalData => ({
  kind: 'itinerary',
  content: toProposalContent({ cover: { title: 'Chile y Argentina', stats }, intro: { headline: 'Resumen', body: '<p>x</p>' }, days: [] }),
  pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: 'viewed', termsAccepted: false, acceptedAt: null,
  clientName: 'Persona Ejemplo', destinationText: 'Santiago', startDate: '2026-11-18', endDate: '2026-11-30', travelersCount: 2, serviceChoices: {}, serviceComments: {}
});

describe('PrivateProposal — datos con icono del Resumen (editables desde la portada)', () => {
  async function render(stats?: unknown): Promise<string[]> {
    const api = {
      getProposalGate: vi.fn().mockResolvedValue({ kind: 'itinerary', accessRequired: true, clientName: 'P', coverTitle: 'T', coverImagePath: null, status: 'viewed' }),
      verifyAccess: vi.fn(),
      getContent: vi.fn().mockResolvedValue(itinerary(stats)),
      getDocuments: vi.fn().mockResolvedValue([])
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
    sessionStorage.setItem(`${PROPOSAL_SESSION_PREFIX}${TOKEN}`, JSON.stringify({ sessionToken: SESSION, expiresAt: null }));
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
    const fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    const items = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll('.proposal__summary-item')).map((i) =>
      Array.from(i.querySelectorAll('p')).map((p) => p.textContent?.trim() ?? '').join(' ')
    );
    // El componente arma el scroll-spy y las animaciones con timers de ~60 ms: se esperan antes de soltar los stubs.
    await new Promise((resolve) => setTimeout(resolve, 120));
    fixture.destroy();
    return items;
  }

  afterEach(() => {
    sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it('sin texto escrito: los cuatro datos automáticos', async () => {
    expect(await render()).toEqual(['13 días 12 noches', '2 viajeros', 'Otoño Noviembre 2026', 'Viaje a medida Experiencias únicas']);
  }, 20_000);

  it('lo escrito en la portada reemplaza al automático; lo vacío sigue siendo automático', async () => {
    expect(await render({ duration: { value: '13 días / 12 noches' }, season: { label: 'Primavera austral' }, custom: { value: 'Itinerario privado', label: 'Solo para ustedes' } })).toEqual([
      '13 días / 12 noches 12 noches', '2 viajeros', 'Otoño Primavera austral', 'Itinerario privado Solo para ustedes'
    ]);
  }, 20_000);
});
