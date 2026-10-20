import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PreviewStep } from './preview-step';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../core/services/proposal-service-attachments';
import { ProposalServiceAttachment } from '../../../../core/models/proposal-service-attachment.model';
import { toProposalContent } from '../../../../core/models/proposal.model';

const service = (id: string, title: string) => ({ id, type: 'flight', title, description: '', notes: '', time: '', imagePath: null, details: {} });
const att = (id: string, serviceId: string, over: Partial<ProposalServiceAttachment> = {}): ProposalServiceAttachment => ({
  id, proposalId: 'p1', serviceId, fileName: `${id}.pdf`, mimeType: 'application/pdf', fileSize: 1024,
  visibleToClient: false, createdAt: 't', updatedAt: 't', ...over
});

describe('PreviewStep — documentos por servicio', () => {
  let attachments: { listForProposal: ReturnType<typeof vi.fn>; getUrl: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<PreviewStep>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  async function create(docs: ProposalServiceAttachment[]): Promise<void> {
    attachments.listForProposal.mockResolvedValue(docs);
    fixture = TestBed.createComponent(PreviewStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
    fixture.componentInstance.itineraryExpanded.set(true); // los servicios se pintan con el itinerario expandido
    await settle();
  }

  beforeEach(() => {
    // Sin animaciones (gsap) en las pruebas.
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    attachments = { listForProposal: vi.fn(), getUrl: vi.fn().mockResolvedValue('https://signed.test/doc') };
    const proposal = {
      id: 'p1', clientName: 'Persona Ejemplo', startDate: '2027-05-04', endDate: '2027-05-07', travelersCount: 2, currency: 'USD',
      serviceChoices: {}, serviceComments: {}, termsAccepted: false, acceptedAt: null, acceptedByName: null,
      content: toProposalContent({
        cover: { title: 'Viaje de prueba' },
        days: [{ id: 'd1', dayNumber: 1, title: 'Llegada', location: '', description: '', imagePath: null, services: [service('s1', 'Vuelo CM385'), service('s2', 'Hotel Faro')] }]
      })
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: { getById: vi.fn().mockResolvedValue(proposal) } },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: ProposalServiceAttachmentsService, useValue: attachments }
      ]
    });
  });

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('muestra los documentos bajo su servicio, con su estado de visibilidad para el cliente', async () => {
    await create([att('boleto', 's1', { fileName: 'Boleto aéreo CM385.pdf', visibleToClient: true }), att('interno', 's1')]);
    const sections = Array.from(el().querySelectorAll('.preview__service-docs'));
    expect(sections.length).toBe(1);
    const text = sections[0].textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Boleto aéreo CM385');
    expect(text).toContain('Visible para el cliente');
    expect(text).toContain('interno');
    expect(text).toContain('Solo interno');
    expect(sections[0].closest('li')?.textContent).toContain('Vuelo CM385');
    expect(sections[0].closest('li')?.textContent).not.toContain('Hotel Faro');
  });

  it('un servicio sin documentos no muestra la sección', async () => {
    await create([]);
    expect(el().querySelector('.preview__service-docs')).toBeNull();
  });

  it('«Ver documento →» pide la URL firmada y la abre como blob en una pestaña nueva', async () => {
    const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('%PDF-1.4', { status: 200 })));
    const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:https://app.test/doc-1');
    await create([att('boleto', 's1')]);
    (el().querySelector('.preview__service-doc-open') as HTMLButtonElement).click();
    await settle();
    expect(attachments.getUrl).toHaveBeenCalledWith('boleto');
    expect((createUrl.mock.calls[0][0] as Blob).type).toBe('application/pdf');
    expect(tab.location.href).toBe('blob:https://app.test/doc-1');
    expect(tab.opener).toBeNull();
  });

  it('si falla pedir la URL, se cierra la pestaña y se avisa', async () => {
    const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
    vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    attachments.getUrl.mockRejectedValue(new Error('x'));
    await create([att('boleto', 's1')]);
    (el().querySelector('.preview__service-doc-open') as HTMLButtonElement).click();
    await settle();
    expect(tab.close).toHaveBeenCalled();
    expect(el().textContent).toContain('No se pudo abrir el documento');
  });

  it('si no se pueden cargar los documentos, la vista previa se ve igual', async () => {
    attachments.listForProposal.mockRejectedValue(new Error('rls'));
    fixture = TestBed.createComponent(PreviewStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
    expect(el().textContent).toContain('Viaje de prueba');
    expect(el().querySelector('.preview__service-docs')).toBeNull();
  });
});
