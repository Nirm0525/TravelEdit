import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../core/services/proposal-service-attachments';
import { AttachmentApiError, ProposalServiceAttachment } from '../../../../core/models/proposal-service-attachment.model';
import {
  ProposalContent,
  ProposalDay,
  ProposalServiceItem,
  createProposalDay,
  createProposalService
} from '../../../../core/models/proposal.model';
import { PROPOSAL_SERVICE_TYPE_LABEL, ProposalServiceType } from '../../../../core/models/proposal-enums';
import { PROPOSAL_SERVICE_TYPE_OPTIONS } from '../../../../core/data/proposal-options';
import { PROPOSAL_SERVICE_FIELDS } from '../../../../core/data/proposal-service-fields';
import { ImageUploader, ReadyImage } from '../../../../shared/ui/image-uploader/image-uploader';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog/confirm-dialog';
import { ServiceDocuments } from './service-documents/service-documents';

type DayField = 'title' | 'location' | 'description';
type ServiceField = 'title' | 'description' | 'notes' | 'time';

@Component({
  selector: 'app-build-journey-step',
  imports: [DragDropModule, ImageUploader, ConfirmDialog, ServiceDocuments],
  templateUrl: './build-journey-step.html',
  styleUrl: './build-journey-step.css'
})
export class BuildJourneyStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);
  private readonly attachmentsService = inject(ProposalServiceAttachmentsService);

  readonly proposalId = input.required<string>();
  readonly saved = output<void>();
  /** Target key de ai-polish-step (`day_description:<dayId>`) a preseleccionar
   *  cuando el shell active The Edit Assistant desde el botón ✨ contextual. */
  readonly openAssistant = output<string>();

  readonly serviceTypeOptions = PROPOSAL_SERVICE_TYPE_OPTIONS;
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;
  /** Campos de la ficha por tipo, sin 'time' — la hora ya tiene su propio
   *  input en la fila superior de cada servicio. */
  readonly serviceFields = (type: ProposalServiceType) => PROPOSAL_SERVICE_FIELDS[type].filter((f) => f.key !== 'time');

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly days = signal<ProposalDay[]>([]);
  readonly dayImageUrls = signal<Record<string, string | null>>({});
  readonly serviceImageUrls = signal<Record<string, string | null>>({});
  readonly uploadingDayId = signal<string | null>(null);
  readonly uploadingServiceId = signal<string | null>(null);
  readonly dayPendingDelete = signal<ProposalDay | null>(null);

  /** Documentos adjuntos de TODA la propuesta (una sola consulta); cada servicio muestra los suyos. */
  readonly attachments = signal<ProposalServiceAttachment[]>([]);
  readonly attachmentsError = signal<string | null>(null);
  readonly attachmentsByService = computed(() => {
    const map: Record<string, ProposalServiceAttachment[] | undefined> = {};
    for (const attachment of this.attachments()) {
      (map[attachment.serviceId] ??= []).push(attachment);
    }
    return map;
  });
  readonly noAttachments: ProposalServiceAttachment[] = [];

  /** Servicio o día que se quiere borrar y tiene documentos: espera la confirmación explícita del usuario. */
  readonly removalWithDocs = signal<{ kind: 'service' | 'day'; day: ProposalDay; service?: ProposalServiceItem; count: number } | null>(null);
  readonly removalWithDocsMessage = computed(() => {
    const pending = this.removalWithDocs();
    if (!pending) {
      return '';
    }
    const docs = `${pending.count} documento${pending.count === 1 ? ' adjunto' : 's adjuntos'}`;
    return pending.kind === 'service'
      ? `Este servicio tiene ${docs}. Si lo eliminas, los archivos también se borrarán de forma permanente. ¿Continuar?`
      : `Este día tiene ${docs} en sus servicios. Si lo eliminas, los archivos también se borrarán de forma permanente. ¿Continuar?`;
  });

  private content: ProposalContent | null = null;

  // Ver el comentario equivalente en client-trip-step.ts — proposalId (input
  // required) no tiene valor todavía dentro del constructor, dispara NG0950.
  ngOnInit(): void {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const proposal = await this.proposalsService.getById(this.proposalId());
      if (!proposal) {
        this.loadError.set('No se encontró la propuesta.');
        return;
      }
      this.content = proposal.content;
      this.days.set(proposal.content.days);
      this.refreshDayImageUrls(proposal.content.days);
      this.refreshServiceImageUrls(proposal.content.days);
      void this.loadAttachments();
    } catch (error) {
      console.error('No se pudo cargar el itinerario.', error);
      this.loadError.set('No se pudo cargar el itinerario. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  async loadAttachments(): Promise<void> {
    this.attachmentsError.set(null);
    try {
      this.attachments.set(await this.attachmentsService.listForProposal(this.proposalId()));
    } catch (error) {
      console.error('No se pudieron cargar los documentos adjuntos.', error);
      this.attachmentsError.set('No se pudieron cargar los documentos adjuntos.');
    }
  }

  onAttachmentsChanged(serviceId: string, list: ProposalServiceAttachment[]): void {
    this.attachments.update((all) => [...all.filter((a) => a.serviceId !== serviceId), ...list]);
    // La vista previa del constructor se refresca con cada guardado: también debe mostrar los documentos nuevos.
    this.saved.emit();
  }

  private refreshDayImageUrls(days: ProposalDay[]): void {
    const map: Record<string, string | null> = {};
    for (const day of days) {
      map[day.id] = this.proposalImages.publicUrl(day.imagePath);
    }
    this.dayImageUrls.set(map);
  }

  private refreshServiceImageUrls(days: ProposalDay[]): void {
    const map: Record<string, string | null> = {};
    for (const day of days) {
      for (const service of day.services) {
        map[service.id] = this.proposalImages.publicUrl(service.imagePath ?? null);
      }
    }
    this.serviceImageUrls.set(map);
  }

  // Bug real encontrado en QA (mismo patrón que client-trip-step.ts):
  // cada acción (editar un campo, subir una imagen, reordenar) calculaba
  // "next" a partir de this.days() en el momento del evento y llamaba
  // persist(next) sin esperar a que guardados anteriores terminaran. Dos
  // acciones casi simultáneas (ej. escribir el título y luego la ubicación
  // de un día, con poco tiempo entre medio) partían ambas del mismo
  // this.days() viejo — la que terminaba de guardar último pisaba a la otra
  // y el primer cambio se perdía entero, no solo quedaba en null como en
  // client-trip-step. La cola resuelve esto igual: cada mutación se aplica
  // recién en su turno, sobre this.days() ya actualizado por la anterior.
  private saveChain: Promise<void> = Promise.resolve();

  /** mutate() recibe el array YA actualizado por cualquier guardado previo en
   *  la cola — nunca una copia vieja tomada al momento del evento. */
  private enqueueMutation(mutate: (days: ProposalDay[]) => ProposalDay[]): Promise<void> {
    const run = this.saveChain.then(() => this.persist(mutate(this.days())));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  /** Único punto de guardado: siempre persiste `content` completo (no un
   *  PATCH parcial) — content.pricing/terms/intro/cover, cargados en el
   *  paso 01/03, viajan intactos porque `this.content` se cargó entero al
   *  entrar a este paso y solo se muta la porción `days`. */
  private async persist(nextDays: ProposalDay[]): Promise<void> {
    if (!this.content) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    const nextContent: ProposalContent = { ...this.content, days: nextDays };
    try {
      const updated = await this.proposalsService.updateContent(this.proposalId(), nextContent);
      this.content = updated.content;
      this.days.set(updated.content.days);
      this.refreshDayImageUrls(updated.content.days);
      this.refreshServiceImageUrls(updated.content.days);
      this.saved.emit();
    } catch (error) {
      console.error('No se pudo guardar el itinerario.', error);
      this.saveError.set('No se pudo guardar. Inténtalo nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  private renumber(days: ProposalDay[]): ProposalDay[] {
    return days.map((day, index) => ({ ...day, dayNumber: index + 1 }));
  }

  addDay(): Promise<void> {
    return this.enqueueMutation((days) => this.renumber([...days, createProposalDay(days.length + 1)]));
  }

  requestRemoveDay(day: ProposalDay): void {
    this.saveError.set(null);
    this.dayPendingDelete.set(day);
  }

  cancelRemoveDay(): void {
    this.dayPendingDelete.set(null);
  }

  confirmRemoveDay(): Promise<void> {
    const day = this.dayPendingDelete();
    if (!day) {
      return Promise.resolve();
    }
    this.dayPendingDelete.set(null);
    return this.runRemoval({ kind: 'day', day });
  }

  dropDay(event: CdkDragDrop<ProposalDay[]>): Promise<void> {
    const { previousIndex, currentIndex } = event;
    return this.enqueueMutation((days) => {
      const reordered = [...days];
      moveItemInArray(reordered, previousIndex, currentIndex);
      return this.renumber(reordered);
    });
  }

  onDayFieldBlur(day: ProposalDay, field: DayField, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    return this.enqueueMutation((days) => days.map((d) => (d.id === day.id ? { ...d, [field]: value } : d)));
  }

  async onDayImageSelected(day: ProposalDay, images: ReadyImage[]): Promise<void> {
    const image = images[0];
    if (!image) {
      return;
    }
    this.uploadingDayId.set(day.id);
    this.saveError.set(null);
    try {
      const path = await this.proposalImages.upload(image.file);
      await this.enqueueMutation((days) => days.map((d) => (d.id === day.id ? { ...d, imagePath: path } : d)));
    } catch (error) {
      console.error('No se pudo subir la imagen del día.', error);
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
    } finally {
      this.uploadingDayId.set(null);
    }
  }

  async onServiceImageSelected(day: ProposalDay, service: ProposalServiceItem, images: ReadyImage[]): Promise<void> {
    const image = images[0];
    if (!image) {
      return;
    }
    this.uploadingServiceId.set(service.id);
    this.saveError.set(null);
    try {
      const path = await this.proposalImages.upload(image.file);
      await this.enqueueMutation((days) =>
        days.map((d) =>
          d.id === day.id
            ? { ...d, services: d.services.map((s) => (s.id === service.id ? { ...s, imagePath: path } : s)) }
            : d
        )
      );
    } catch (error) {
      console.error('No se pudo subir la imagen del servicio.', error);
      this.saveError.set(error instanceof Error ? error.message : 'No se pudo subir la imagen.');
    } finally {
      this.uploadingServiceId.set(null);
    }
  }

  addService(day: ProposalDay, type: ProposalServiceType): Promise<void> {
    const service = createProposalService(type);
    return this.enqueueMutation((days) =>
      days.map((d) => (d.id === day.id ? { ...d, services: [...d.services, service] } : d))
    );
  }

  removeService(day: ProposalDay, service: ProposalServiceItem): Promise<void> {
    return this.runRemoval({ kind: 'service', day, service });
  }

  confirmRemovalWithDocs(): Promise<void> {
    const pending = this.removalWithDocs();
    this.removalWithDocs.set(null);
    return pending ? this.runRemoval(pending, { expectedCount: pending.count }) : Promise.resolve();
  }

  cancelRemovalWithDocs(): void {
    this.removalWithDocs.set(null);
  }

  /**
   * Borrar un servicio o un día pasa por el servidor, no por el guardado normal de `days`: el servidor lo quita del
   * contenido ACTUAL de la base (una pestaña vieja no puede pisar días ni servicios) y purga sus documentos. Si hay
   * documentos pide antes una confirmación explícita (el recuento que ve el usuario viaja con la confirmación).
   * Va detrás de la cola de guardados para no adelantarse a ediciones pendientes.
   */
  private runRemoval(
    target: { kind: 'service' | 'day'; day: ProposalDay; service?: ProposalServiceItem },
    confirmation?: { expectedCount: number }
  ): Promise<void> {
    const run = this.saveChain.then(() => this.executeRemoval(target, confirmation));
    this.saveChain = run.catch(() => undefined);
    return run;
  }

  private async executeRemoval(
    target: { kind: 'service' | 'day'; day: ProposalDay; service?: ProposalServiceItem },
    confirmation?: { expectedCount: number }
  ): Promise<void> {
    if (!this.content) {
      return;
    }
    this.saving.set(true);
    this.saveError.set(null);
    try {
      const outcome =
        target.kind === 'service'
          ? await this.attachmentsService.removeService(this.proposalId(), target.day.id, target.service!.id, confirmation)
          : await this.attachmentsService.removeDay(this.proposalId(), target.day.id, confirmation);
      this.content = outcome.content;
      this.days.set(outcome.content.days);
      this.refreshDayImageUrls(outcome.content.days);
      this.refreshServiceImageUrls(outcome.content.days);
      const alive = new Set(outcome.content.days.flatMap((d) => d.services.map((s) => s.id)));
      this.attachments.update((all) => all.filter((a) => alive.has(a.serviceId)));
      this.saved.emit();
    } catch (error) {
      if (error instanceof AttachmentApiError && (error.code === 'confirmation_required' || error.code === 'count_changed')) {
        this.removalWithDocs.set({ ...target, count: error.attachmentCount });
      } else {
        console.error('No se pudo eliminar.', error);
        this.saveError.set(error instanceof Error ? error.message : 'No se pudo eliminar. Inténtalo nuevamente.');
        // Una purga parcial pudo borrar documentos: se vuelve a leer la lista real.
        void this.loadAttachments();
      }
    } finally {
      this.saving.set(false);
    }
  }

  dropService(day: ProposalDay, event: CdkDragDrop<ProposalServiceItem[]>): Promise<void> {
    const { previousIndex, currentIndex } = event;
    return this.enqueueMutation((days) =>
      days.map((d) => {
        if (d.id !== day.id) {
          return d;
        }
        const services = [...d.services];
        moveItemInArray(services, previousIndex, currentIndex);
        return { ...d, services };
      })
    );
  }

  onServiceDetailBlur(day: ProposalDay, service: ProposalServiceItem, key: string, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).value;
    return this.enqueueMutation((days) =>
      days.map((d) =>
        d.id === day.id
          ? {
              ...d,
              services: d.services.map((s) =>
                s.id === service.id ? { ...s, details: { ...(s.details ?? {}), [key]: value } } : s
              )
            }
          : d
      )
    );
  }

  onServiceFieldBlur(day: ProposalDay, service: ProposalServiceItem, field: ServiceField, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    return this.enqueueMutation((days) =>
      days.map((d) =>
        d.id === day.id
          ? { ...d, services: d.services.map((s) => (s.id === service.id ? { ...s, [field]: value } : s)) }
          : d
      )
    );
  }
}
