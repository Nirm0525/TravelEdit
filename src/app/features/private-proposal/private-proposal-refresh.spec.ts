import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { PROPOSAL_SESSION_PREFIX, ProposalDocument, PublicProposalData, PublicProposalService } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '36363636-3636-4636-8636-363636363636';
const SESSION = '46464646-4646-4646-8646-464646464646';

const itinerary = (title: string): PublicProposalData => ({
  kind: 'itinerary',
  content: toProposalContent({ cover: { title }, days: [] }),
  pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: 'viewed', termsAccepted: false, acceptedAt: null,
  clientName: 'Persona Ejemplo', destinationText: null, startDate: null, endDate: null, travelersCount: null, serviceChoices: {}, serviceComments: {}
});
const doc = (name: string): ProposalDocument => ({ id: name, serviceId: 's1', name, mimeType: 'application/pdf' });

// Un itinerario compartido no congela una versión: cada apertura o recarga del MISMO enlace vuelve a pedir el contenido y los
// documentos con la sesión guardada; la pestaña solo conserva la autorización, nunca el contenido.
describe('PrivateProposal — recarga de un itinerario ya compartido', () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments', ReturnType<typeof vi.fn>>;

  const open = async () => {
    const fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    return fixture;
  };

  beforeEach(() => {
    api = {
      getProposalGate: vi.fn().mockResolvedValue({ kind: 'itinerary', accessRequired: true, clientName: 'Persona Ejemplo', coverTitle: 'Viaje', coverImagePath: null, status: 'viewed' }),
      verifyAccess: vi.fn(),
      getContent: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue([])
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
    sessionStorage.clear();
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
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('al recargar pide el contenido y los documentos otra vez con la sesión guardada, sin pedir el código ni emitir otra sesión', async () => {
    api.getContent.mockResolvedValueOnce(itinerary('Versión 1')).mockResolvedValueOnce(itinerary('Versión 2'));
    api.getDocuments.mockResolvedValueOnce([]).mockResolvedValueOnce([doc('voucher.pdf')]);

    const first = await open();
    expect(first.componentInstance.data()?.content.cover.title).toBe('Versión 1');
    expect(first.componentInstance.documents()).toEqual([]);
    first.destroy();

    const second = await open(); // misma URL, misma pestaña: «refresh»
    expect(second.componentInstance.data()?.content.cover.title).toBe('Versión 2');
    expect(second.componentInstance.documents().map((d) => d.name)).toEqual(['voucher.pdf']);

    expect(api.getProposalGate).toHaveBeenCalledTimes(2);
    expect(api.getContent).toHaveBeenCalledTimes(2);
    expect(api.getContent).toHaveBeenNthCalledWith(2, TOKEN, SESSION);
    expect(api.getDocuments).toHaveBeenCalledTimes(2);
    expect(api.verifyAccess).not.toHaveBeenCalled();
    second.destroy();
  }, 20_000);

  it('la pestaña solo guarda la sesión: ni el contenido ni los documentos quedan en el almacenamiento', async () => {
    api.getContent.mockResolvedValue(itinerary('Portada secreta XYZ'));
    api.getDocuments.mockResolvedValue([doc('Boleto-secreto.pdf')]);
    const fixture = await open();
    expect(fixture.componentInstance.data()?.content.cover.title).toBe('Portada secreta XYZ');

    const dump = JSON.stringify([...Object.entries(sessionStorage), ...Object.entries(localStorage)]);
    expect(dump).toContain(SESSION);
    expect(dump).not.toContain('Portada secreta XYZ');
    expect(dump).not.toContain('Boleto-secreto');
    expect(Object.keys(sessionStorage)).toEqual([`${PROPOSAL_SESSION_PREFIX}${TOKEN}`]);
    fixture.destroy();
  }, 20_000);
});
