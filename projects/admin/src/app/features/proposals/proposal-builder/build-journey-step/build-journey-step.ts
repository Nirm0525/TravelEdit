import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import {
  ProposalContent,
  ProposalDay,
  ProposalServiceItem,
  createProposalDay,
  createProposalService
} from '../../../../core/models/proposal.model';
import { PROPOSAL_SERVICE_TYPE_LABEL, ProposalServiceType } from '../../../../core/models/proposal-enums';
import { PROPOSAL_SERVICE_TYPE_OPTIONS } from '../../../../core/data/proposal-options';
import { ImageUploader, ReadyImage } from '../../../../shared/ui/image-uploader/image-uploader';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog/confirm-dialog';

type DayField = 'title' | 'location' | 'description';
type ServiceField = 'title' | 'description' | 'notes';

@Component({
  selector: 'app-build-journey-step',
  imports: [DragDropModule, ImageUploader, ConfirmDialog],
  templateUrl: './build-journey-step.html',
  styleUrl: './build-journey-step.css'
})
export class BuildJourneyStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);

  readonly proposalId = input.required<string>();
  readonly saved = output<void>();
  /** Target key de ai-polish-step (`day_description:<dayId>`) a preseleccionar
   *  cuando el shell active The Edit Assistant desde el botón ✨ contextual. */
  readonly openAssistant = output<string>();

  readonly serviceTypeOptions = PROPOSAL_SERVICE_TYPE_OPTIONS;
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saveError = signal<string | null>(null);

  readonly days = signal<ProposalDay[]>([]);
  readonly dayImageUrls = signal<Record<string, string | null>>({});
  readonly uploadingDayId = signal<string | null>(null);
  readonly dayPendingDelete = signal<ProposalDay | null>(null);

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
    } catch (error) {
      console.error('No se pudo cargar el itinerario.', error);
      this.loadError.set('No se pudo cargar el itinerario. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  private refreshDayImageUrls(days: ProposalDay[]): void {
    const map: Record<string, string | null> = {};
    for (const day of days) {
      map[day.id] = this.proposalImages.publicUrl(day.imagePath);
    }
    this.dayImageUrls.set(map);
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
    return this.enqueueMutation((days) => this.renumber(days.filter((d) => d.id !== day.id)));
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

  addService(day: ProposalDay, type: ProposalServiceType): Promise<void> {
    const service = createProposalService(type);
    return this.enqueueMutation((days) =>
      days.map((d) => (d.id === day.id ? { ...d, services: [...d.services, service] } : d))
    );
  }

  removeService(day: ProposalDay, service: ProposalServiceItem): Promise<void> {
    return this.enqueueMutation((days) =>
      days.map((d) => (d.id === day.id ? { ...d, services: d.services.filter((s) => s.id !== service.id) } : d))
    );
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
