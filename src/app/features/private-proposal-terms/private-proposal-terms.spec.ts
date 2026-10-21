import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposalTerms } from './private-proposal-terms';
import { PROPOSAL_SESSION_PREFIX, PublicProposalData, PublicProposalService, TravelKind } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '31313131-3131-4131-8131-313131313131';

const data = (kind: TravelKind): PublicProposalData => ({
  kind,
  content: toProposalContent({ cover: { title: 'Viaje' }, terms: { title: 'Condiciones', body: '<p>Texto de los términos</p>' } }),
  pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: kind === 'itinerary' ? 'shared' : 'published', termsAccepted: false,
  acceptedAt: null, clientName: 'Persona', destinationText: null, startDate: null, endDate: null, travelersCount: null, serviceChoices: {}, serviceComments: {}
});

describe('PrivateProposalTerms — la página de términos es solo de propuestas', () => {
  let fixture: ComponentFixture<PrivateProposalTerms>;
  const getContent = vi.fn();

  async function open(withSession = true): Promise<void> {
    sessionStorage.clear();
    if (withSession) {
      sessionStorage.setItem(`${PROPOSAL_SESSION_PREFIX}${TOKEN}`, JSON.stringify({ sessionToken: 'sess' }));
    }
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: { getContent } }] });
    fixture = TestBed.createComponent(PrivateProposalTerms);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  afterEach(() => {
    fixture?.destroy();
    getContent.mockReset();
  });

  it('una propuesta con términos los muestra', async () => {
    getContent.mockResolvedValue(data('proposal'));
    await open();
    expect(fixture.componentInstance.phase()).toBe('ready');
    expect(fixture.nativeElement.textContent).toContain('Texto de los términos');
  });

  it('un itinerario NO tiene página de términos: no disponible, aunque el contenido trajera uno', async () => {
    getContent.mockResolvedValue(data('itinerary'));
    await open();
    expect(fixture.componentInstance.phase()).toBe('unavailable');
    expect(fixture.nativeElement.textContent).not.toContain('Texto de los términos');
  });

  it('sin sesión no se pide nada', async () => {
    await open(false);
    expect(fixture.componentInstance.phase()).toBe('unavailable');
    expect(getContent).not.toHaveBeenCalled();
  });
});
