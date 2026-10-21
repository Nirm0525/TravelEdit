import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PreviewStep } from './preview-step';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../core/services/proposal-service-attachments';
import { ProposalServiceAttachment } from '../../../../core/models/proposal-service-attachment.model';
import { toProposalContent } from '../../../../core/models/proposal.model';
import { TravelMode } from '../../../travel/travel-config';

const service = (id: string, title: string) => ({ id, type: 'hotel', title, description: 'Descripción del servicio', notes: '', time: '', imagePath: null, details: {} });
const doc = (id: string, serviceId: string, visibleToClient: boolean): ProposalServiceAttachment => ({
  id, proposalId: 'p1', serviceId, fileName: `${id}.pdf`, mimeType: 'application/pdf', fileSize: 1024, visibleToClient, createdAt: 't', updatedAt: 't'
});

/** Una fila CONTAMINADA con todo lo contractual: la vista previa de un itinerario no debe pintar nada de eso. */
const row = (kind: TravelMode) => ({
  id: 'p1', kind, status: 'draft', clientName: 'Persona Ejemplo', startDate: '2027-05-04', endDate: '2027-05-07', travelersCount: 2, currency: 'USD',
  pricingTotal: 98765, pricingSubtotal: 98765, pricingFees: 0, termsAccepted: true, acceptedAt: '2027-01-02T00:00:00Z', acceptedByName: 'Quien Acepta',
  serviceChoices: { s1: true }, serviceComments: { s1: 'Cambien la fecha por favor' }, feedbackSentAt: null,
  content: toProposalContent(
    {
      cover: { title: 'Chile de punta a punta', subtitle: 'Un viaje inolvidable' },
      welcome: { body: '<p>Bienvenida personalizada</p>' },
      intro: { headline: 'Resumen del viaje', body: '<p>Texto del resumen</p>' },
      days: [{ id: 'd1', dayNumber: 1, title: 'Llegada a Santiago', location: 'Santiago', description: 'Descripción del día', imagePath: null, services: [service('s1', 'Hotel Faro')] }],
      pricing: { lines: [{ id: 'l1', label: 'Línea de precio secreta', quantity: 1, unitPrice: 98765 }], feesLines: [] },
      travelTips: [{ id: 'g1', destination: 'Santiago', tips: [{ id: 't1', title: 'Clima y equipaje', body: 'Lleva abrigo para la noche', category: 'weather' }] }],
      terms: { title: 'Condiciones secretas', body: '<p>TÉRMINOS CONTRACTUALES</p>' }
    },
    kind
  )
});

describe('PreviewStep — vista previa por modo (travel-config: previewMode)', () => {
  let fixture: ComponentFixture<PreviewStep>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  async function render(rowKind: TravelMode, mode: TravelMode, docs: ProposalServiceAttachment[] = []): Promise<void> {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: { getById: vi.fn().mockResolvedValue(row(rowKind)) } },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: ProposalServiceAttachmentsService, useValue: { listForProposal: vi.fn().mockResolvedValue(docs), getUrl: vi.fn() } }
      ]
    });
    fixture = TestBed.createComponent(PreviewStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    await settle();
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
  }

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  it('itinerario: muestra portada, bienvenida, resumen, días, servicios y Travel Tips', async () => {
    await render('itinerary', 'itinerary');
    for (const wanted of ['Chile de punta a punta', 'Un viaje inolvidable', 'Bienvenida personalizada', 'Resumen del viaje', 'Texto del resumen', 'Llegada a Santiago', 'Hotel Faro', 'Descripción del servicio', 'Clima y equipaje', 'Lleva abrigo para la noche']) {
      expect(text(), wanted).toContain(wanted);
    }
  });

  it('itinerario: NO muestra precios, inversión, términos, aceptación, elecciones ni comentarios de cotización', async () => {
    await render('itinerary', 'itinerary');
    for (const banned of [
      'Inversión', 'Inversión total', 'detalle de costos', '98.765', '98,765', 'Línea de precio secreta',
      'Términos', 'Condiciones secretas', 'TÉRMINOS CONTRACTUALES',
      'Aceptar propuesta', 'aceptada por', 'Quien Acepta', '¿Listos para comenzar?', 'Disponible en la propuesta pública',
      'Aceptado por el cliente', 'Comentario del cliente', 'Cambien la fecha por favor'
    ]) {
      expect(text(), banned).not.toContain(banned);
    }
    expect(el().querySelector('.preview__pricing')).toBeNull();
    expect(el().querySelector('.preview__terms-toggle')).toBeNull();
    expect(el().querySelector('.preview__cta')).toBeNull();
    expect(el().querySelector('.preview__service-chosen')).toBeNull();
    expect(el().querySelector('.preview__service-comment')).toBeNull();
  });

  it('itinerario: los documentos de cada servicio se ven con su estado de visibilidad', async () => {
    await render('itinerary', 'itinerary', [doc('visible', 's1', true), doc('interno', 's1', false)]);
    const docs = el().querySelector('.preview__service-docs')?.textContent?.replace(/\s+/g, ' ') ?? '';
    expect(docs).toContain('Visible para el cliente');
    expect(docs).toContain('Solo interno');
  });

  it('el tipo REAL de la fila manda: un itinerario nunca se pinta con la vista contractual aunque se pida el modo propuesta', async () => {
    await render('itinerary', 'proposal');
    expect(el().querySelector('.preview__pricing')).toBeNull();
    expect(text()).not.toContain('TÉRMINOS CONTRACTUALES');
    expect(text()).not.toContain('Aceptar propuesta');
  });

  it('propuesta: conserva su vista contractual (inversión, términos, botón de aceptar, elecciones y comentarios del cliente)', async () => {
    await render('proposal', 'proposal');
    expect(el().querySelector('.preview__pricing')).not.toBeNull();
    for (const wanted of ['Inversión', 'Condiciones secretas', 'Aceptar propuesta', '✓ Aceptado por el cliente', 'Comentario del cliente', 'Cambien la fecha por favor']) {
      expect(text(), wanted).toContain(wanted);
    }
  });
});
