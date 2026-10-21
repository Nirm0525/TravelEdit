import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { BuildJourneyStep } from './build-journey-step';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../core/services/proposal-service-attachments';
import { AttachmentApiError, ProposalServiceAttachment } from '../../../../core/models/proposal-service-attachment.model';
import { ProposalContent, ProposalDay, toProposalContent } from '../../../../core/models/proposal.model';

const service = (id: string, type: 'flight' | 'hotel' = 'flight') => ({
  id, type, title: `Servicio ${id}`, description: '', notes: '', time: '', imagePath: null, details: {}
});
const day = (id: string, n: number, ids: string[]): ProposalDay => ({
  id, dayNumber: n, title: `Día ${n}`, location: '', description: '', imagePath: null, services: ids.map((s) => service(s))
});
const content = (days: ProposalDay[]): ProposalContent => toProposalContent({ days });
const att = (id: string, serviceId: string, over: Partial<ProposalServiceAttachment> = {}): ProposalServiceAttachment => ({
  id, proposalId: 'p1', serviceId, fileName: `${id}.pdf`, mimeType: 'application/pdf', fileSize: 1024,
  visibleToClient: false, createdAt: 't', updatedAt: 't', ...over
});

describe('BuildJourneyStep — documentos por servicio', () => {
  let proposals: { getById: ReturnType<typeof vi.fn>; updateContent: ReturnType<typeof vi.fn> };
  let attachments: Record<'listForProposal' | 'removeService' | 'removeDay', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<BuildJourneyStep>;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const dangerButton = () => el().querySelector('.admin-modal__panel .btn--danger') as HTMLButtonElement | null;
  const modalText = () => el().querySelector('.admin-modal__panel')?.textContent?.replace(/\s+/g, ' ') ?? '';

  async function create(days: ProposalDay[], docs: ProposalServiceAttachment[] = []): Promise<void> {
    proposals.getById.mockResolvedValue({ id: 'p1', kind: 'proposal', content: content(days) });
    attachments.listForProposal.mockResolvedValue(docs);
    fixture = TestBed.createComponent(BuildJourneyStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    proposals = { getById: vi.fn(), updateContent: vi.fn() };
    attachments = { listForProposal: vi.fn(), removeService: vi.fn(), removeDay: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: proposals },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null, upload: vi.fn() } },
        { provide: ProposalServiceAttachmentsService, useValue: attachments }
      ]
    });
  });

  it('la sección «Documentos del servicio» aparece en CADA servicio, aparte de la imagen', async () => {
    await create([day('d1', 1, ['s1', 's2']), day('d2', 2, ['s3'])]);
    expect(el().querySelectorAll('app-service-documents').length).toBe(3);
    expect(el().querySelectorAll('.service-docs').length).toBe(3);
    // La imagen del servicio sigue siendo otro bloque, con su propio uploader.
    expect(el().querySelectorAll('.service-card__image').length).toBe(3);
    for (const card of Array.from(el().querySelectorAll('.service-card'))) {
      expect(card.querySelector('.service-card__image .service-docs')).toBeNull();
      expect(card.querySelector('.service-docs')).toBeTruthy();
    }
    expect(attachments.listForProposal).toHaveBeenCalledWith('p1');
  });

  it('cada servicio lista solo SUS documentos', async () => {
    await create([day('d1', 1, ['s1', 's2'])], [att('a', 's1'), att('b', 's1'), att('c', 's2', { fileName: 'Confirmación hotel.pdf' })]);
    const sections = Array.from(el().querySelectorAll('.service-docs'));
    expect(sections[0].querySelectorAll('.service-docs__item').length).toBe(2);
    expect(sections[1].querySelectorAll('.service-docs__item').length).toBe(1);
    expect(sections[1].textContent).toContain('Confirmación hotel.pdf');
  });

  it('si no se pueden cargar los documentos, el editor sigue y se ofrece reintentar', async () => {
    proposals.getById.mockResolvedValue({ id: 'p1', kind: 'proposal', content: content([day('d1', 1, ['s1'])]) });
    attachments.listForProposal.mockRejectedValueOnce(new Error('rls')).mockResolvedValueOnce([att('a', 's1')]);
    fixture = TestBed.createComponent(BuildJourneyStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
    expect(text()).toContain('No se pudieron cargar los documentos adjuntos.');
    expect(el().querySelectorAll('.service-card').length).toBe(1);
    (Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Reintentar') as HTMLButtonElement).click();
    await settle();
    expect(el().querySelectorAll('.service-docs__item').length).toBe(1);
  });

  it('borrar un servicio SIN documentos pasa por el servidor sin pedir confirmación extra', async () => {
    await create([day('d1', 1, ['s1', 's2'])]);
    attachments.removeService.mockResolvedValue({ content: content([day('d1', 1, ['s2'])]), deletedDocuments: 0 });
    (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
    await settle();
    expect(attachments.removeService).toHaveBeenCalledWith('p1', 'd1', 's1', undefined, 'proposal');
    expect(el().querySelectorAll('.service-card').length).toBe(1);
    expect(modalText()).toBe('');
    // La baja no se hace con el guardado normal de days (que podría pisar a otra pestaña).
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });

  it('borrar un servicio CON documentos exige confirmación: nada se borra hasta confirmar, y se confirma con el recuento visto', async () => {
    await create([day('d1', 1, ['s1', 's2'])], [att('a', 's1'), att('b', 's1')]);
    attachments.removeService
      .mockRejectedValueOnce(new AttachmentApiError('Hay documentos adjuntos.', 'confirmation_required', { attachmentCount: 2 }))
      .mockResolvedValueOnce({ content: content([day('d1', 1, ['s2'])]), deletedDocuments: 2 });

    (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
    await settle();
    expect(modalText()).toContain('Este servicio tiene 2 documentos adjuntos');
    expect(modalText()).toContain('se borrarán de forma permanente');
    expect(attachments.removeService).toHaveBeenCalledTimes(1);
    expect(el().querySelectorAll('.service-card').length).toBe(2);

    dangerButton()!.click();
    await settle();
    expect(attachments.removeService).toHaveBeenLastCalledWith('p1', 'd1', 's1', { expectedCount: 2 }, 'proposal');
    expect(el().querySelectorAll('.service-card').length).toBe(1);
    // Los documentos del servicio borrado ya no están en pantalla.
    expect(el().querySelectorAll('.service-docs__item').length).toBe(0);
  });

  it('cancelar la confirmación no borra nada', async () => {
    await create([day('d1', 1, ['s1'])], [att('a', 's1')]);
    attachments.removeService.mockRejectedValueOnce(new AttachmentApiError('Hay documentos adjuntos.', 'confirmation_required', { attachmentCount: 1 }));
    (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
    await settle();
    expect(modalText()).toContain('1 documento adjunto');
    (Array.from(el().querySelectorAll('.admin-modal__panel button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement).click();
    await settle();
    expect(attachments.removeService).toHaveBeenCalledTimes(1);
    expect(el().querySelectorAll('.service-card').length).toBe(1);
    expect(el().querySelectorAll('.service-docs__item').length).toBe(1);
  });

  it('si aparecen documentos nuevos tras mostrar la confirmación, vuelve a pedirla con el recuento real', async () => {
    await create([day('d1', 1, ['s1'])], [att('a', 's1')]);
    attachments.removeService
      .mockRejectedValueOnce(new AttachmentApiError('x', 'confirmation_required', { attachmentCount: 1 }))
      .mockRejectedValueOnce(new AttachmentApiError('x', 'count_changed', { attachmentCount: 2 }));
    (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
    await settle();
    dangerButton()!.click();
    await settle();
    expect(modalText()).toContain('2 documentos adjuntos');
    expect(el().querySelectorAll('.service-card').length).toBe(1);
  });

  it('si el servidor falla al borrar, el servicio sigue, se muestra el error y se relee la lista real de documentos', async () => {
    await create([day('d1', 1, ['s1'])], [att('a', 's1')]);
    attachments.removeService.mockRejectedValueOnce(new AttachmentApiError('No se pudieron eliminar todos los documentos.', 'storage_failed'));
    attachments.listForProposal.mockResolvedValueOnce([]);
    (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
    await settle();
    expect(text()).toContain('No se pudieron eliminar todos los documentos.');
    expect(el().querySelectorAll('.service-card').length).toBe(1);
    expect(attachments.listForProposal).toHaveBeenCalledTimes(2);
  });

  it('borrar un día usa el servidor (y pide confirmación adicional si sus servicios tienen documentos)', async () => {
    await create([day('d1', 1, ['s1']), day('d2', 2, ['s2'])], [att('a', 's1')]);
    attachments.removeDay
      .mockRejectedValueOnce(new AttachmentApiError('x', 'confirmation_required', { attachmentCount: 1 }))
      .mockResolvedValueOnce({ content: content([day('d2', 1, ['s2'])]), deletedDocuments: 1 });

    (Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Eliminar día') as HTMLButtonElement).click();
    await settle();
    expect(modalText()).toContain('¿Eliminar el día 1');
    dangerButton()!.click(); // primera confirmación (la de siempre)
    await settle();
    expect(attachments.removeDay).toHaveBeenCalledWith('p1', 'd1', undefined, 'proposal');
    expect(modalText()).toContain('Este día tiene 1 documento adjunto');
    expect(el().querySelectorAll('.day-card').length).toBe(2);

    dangerButton()!.click(); // segunda: con documentos
    await settle();
    expect(attachments.removeDay).toHaveBeenLastCalledWith('p1', 'd1', { expectedCount: 1 }, 'proposal');
    expect(el().querySelectorAll('.day-card').length).toBe(1);
  });

  // ------------------------------------------------------------ autosave vs borrado en servidor

  describe('autosave pendiente vs borrar un servicio con documentos', () => {
    const serviceIds = (content: ProposalContent) => content.days.flatMap((d) => d.services.map((sv) => sv.id));
    const titleInput = (index: number) => el().querySelectorAll<HTMLInputElement>('input[placeholder="Título del servicio"]')[index];
    const edit = (index: number, value: string) => {
      const input = titleInput(index);
      input.value = value;
      input.dispatchEvent(new Event('blur'));
    };

    it('un autosave antiguo que termina tarde NO resucita el servicio borrado, y nada lo vuelve a guardar', async () => {
      await create([day('d1', 1, ['s1', 's2'])], [att('a', 's1')]);

      // 1) Autosave antiguo pendiente: una edición del servicio s2 cuyo guardado todavía no termina.
      let finishOldAutosave!: (v: { content: ProposalContent }) => void;
      proposals.updateContent.mockImplementationOnce(
        () => new Promise((resolve) => (finishOldAutosave = resolve as typeof finishOldAutosave))
      );
      proposals.updateContent.mockImplementation(async (_id: string, c: ProposalContent) => ({ content: c }));
      edit(1, 'Hotel editado');
      await settle();
      expect(proposals.updateContent).toHaveBeenCalledTimes(1);
      const staleContent = proposals.updateContent.mock.calls[0][1] as ProposalContent;
      expect(serviceIds(staleContent)).toEqual(['s1', 's2']); // ese guardado viejo todavía lleva s1

      // 2) Se elimina el servicio con documento: queda DETRÁS del autosave (misma cola), el servidor aún no se llama.
      const callOrder: string[] = [];
      attachments.removeService
        .mockImplementationOnce(async () => {
          callOrder.push('remove(sin confirmar)');
          throw new AttachmentApiError('Hay documentos adjuntos.', 'confirmation_required', { attachmentCount: 1 });
        })
        .mockImplementationOnce(async () => {
          callOrder.push('remove(confirmado)');
          // 3) El backend borra sobre el contenido ACTUAL de la base y devuelve el contenido sin el servicio.
          return { content: content([{ ...day('d1', 1, ['s2']), services: [{ ...service('s2'), title: 'Hotel editado' }] }]), deletedDocuments: 1 };
        });
      (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
      await settle();
      expect(attachments.removeService).not.toHaveBeenCalled();

      // 4) El autosave viejo termina AHORA (tarde) devolviendo su contenido, que aún trae s1.
      callOrder.push('autosave viejo termina');
      finishOldAutosave({ content: staleContent });
      await settle();
      expect(callOrder).toEqual(['autosave viejo termina', 'remove(sin confirmar)']);
      expect(modalText()).toContain('Este servicio tiene 1 documento adjunto');

      dangerButton()!.click();
      await settle();
      expect(callOrder).toEqual(['autosave viejo termina', 'remove(sin confirmar)', 'remove(confirmado)']);

      // 5) El servicio NO vuelve a aparecer: ni en pantalla ni en ningún guardado posterior.
      expect(el().querySelectorAll('.service-card').length).toBe(1);
      expect(el().textContent).not.toContain('Servicio s1');
      const callsBefore = proposals.updateContent.mock.calls.length;
      edit(0, 'Otro cambio después del borrado');
      await settle();
      expect(proposals.updateContent.mock.calls.length).toBe(callsBefore + 1);
      const later = proposals.updateContent.mock.calls.at(-1)![1] as ProposalContent;
      expect(serviceIds(later)).toEqual(['s2']);
      // Y tampoco se conservó la edición anterior de s2: parte del contenido que devolvió el servidor.
      expect(later.days[0].services[0].title).toBe('Otro cambio después del borrado');
      for (const call of proposals.updateContent.mock.calls.slice(callsBefore)) {
        expect(serviceIds(call[1] as ProposalContent)).not.toContain('s1');
      }
      // El borrado no se hizo con el guardado normal de days.
      expect(proposals.updateContent.mock.calls.filter((c) => !serviceIds(c[1] as ProposalContent).includes('s1')).length).toBe(1);
    });

    it('una edición encolada DESPUÉS de pedir el borrado también parte del contenido que devolvió el servidor', async () => {
      await create([day('d1', 1, ['s1', 's2'])], []);
      proposals.updateContent.mockImplementation(async (_id: string, c: ProposalContent) => ({ content: c }));
      let finishRemoval!: (v: { content: ProposalContent; deletedDocuments: number }) => void;
      attachments.removeService.mockImplementationOnce(() => new Promise((resolve) => (finishRemoval = resolve as typeof finishRemoval)));

      (el().querySelector('.service-card__remove') as HTMLButtonElement).click();
      await settle();
      expect(attachments.removeService).toHaveBeenCalledTimes(1);
      edit(1, 'Editado mientras se borra'); // se encola detrás del borrado en curso
      await settle();
      expect(proposals.updateContent).not.toHaveBeenCalled();

      finishRemoval({ content: content([day('d1', 1, ['s2'])]), deletedDocuments: 0 });
      await settle();
      expect(proposals.updateContent).toHaveBeenCalledTimes(1);
      expect(serviceIds(proposals.updateContent.mock.calls[0][1] as ProposalContent)).toEqual(['s2']);
    });
  });
});
