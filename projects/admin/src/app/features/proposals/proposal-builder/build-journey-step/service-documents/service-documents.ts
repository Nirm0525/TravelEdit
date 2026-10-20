import { Component, computed, inject, input, output, signal } from '@angular/core';
import { ProposalServiceAttachmentsService } from '../../../../../core/services/proposal-service-attachments';
import {
  AttachmentApiError,
  ProposalServiceAttachment,
  UploadPhase
} from '../../../../../core/models/proposal-service-attachment.model';
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MAX_PER_SERVICE,
  displayNameWithoutExtension,
  formatFileSize,
  validateAttachmentFile
} from '../../../../../core/utils/service-attachments';
import { resolveViewableUrl } from '../../../../../core/utils/open-document';
import { ConfirmDialog } from '../../../../../shared/ui/confirm-dialog/confirm-dialog';

const PHASE_LABEL: Record<UploadPhase, string> = {
  authorizing: 'Preparando…',
  uploading: 'Subiendo…',
  finalizing: 'Verificando…'
};

/**
 * Sección "Documentos del servicio": archivos asociados a UN servicio del itinerario (boleto, voucher,
 * confirmación…). Separada de la imagen del servicio, que es otra cosa y no se toca. Cada documento se puede abrir,
 * reemplazar, eliminar y marcar como visible para el cliente (por defecto NO lo es).
 */
@Component({
  selector: 'app-service-documents',
  imports: [ConfirmDialog],
  templateUrl: './service-documents.html',
  styleUrl: './service-documents.css'
})
export class ServiceDocuments {
  private readonly attachmentsService = inject(ProposalServiceAttachmentsService);

  readonly proposalId = input.required<string>();
  readonly serviceId = input.required<string>();
  /** Documentos de ESTE servicio (los carga el editor una sola vez para toda la propuesta). */
  readonly attachments = input<ProposalServiceAttachment[]>([]);
  /** Se emite con la lista nueva de este servicio después de cada cambio. */
  readonly changed = output<ProposalServiceAttachment[]>();

  readonly accept = ATTACHMENT_ACCEPT;
  readonly maxFiles = ATTACHMENT_MAX_PER_SERVICE;
  readonly formatSize = formatFileSize;
  readonly isImage = (a: ProposalServiceAttachment) => a.mimeType.startsWith('image/');
  readonly displayName = (a: ProposalServiceAttachment) => displayNameWithoutExtension(a.fileName);

  /** Mientras algo está en curso, todo lo demás de la sección queda bloqueado (evita dobles subidas y carreras). */
  readonly busy = signal(false);
  readonly busyLabel = signal('');
  readonly busyId = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly pendingDelete = signal<ProposalServiceAttachment | null>(null);

  readonly atLimit = computed(() => this.attachments().length >= this.maxFiles);

  private replaceTarget: ProposalServiceAttachment | null = null;

  // ------------------------------------------------------------ adjuntar

  async onFilesSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // permite volver a elegir el mismo archivo
    if (files.length === 0) {
      return;
    }
    if (this.busy()) {
      return;
    }
    this.error.set(null);
    const room = this.maxFiles - this.attachments().length;
    const errors: string[] = [];
    // Lista local: el input del padre se actualiza en el siguiente ciclo, no entre una subida y la siguiente.
    let current = this.attachments();
    this.busy.set(true);
    try {
      for (const [index, file] of files.entries()) {
        if (index >= room) {
          errors.push(`${file.name}: cada servicio admite hasta ${this.maxFiles} documentos.`);
          continue;
        }
        const invalid = validateAttachmentFile(file);
        if (invalid) {
          errors.push(`${file.name}: ${invalid}`);
          continue;
        }
        try {
          const created = await this.attachmentsService.upload(this.proposalId(), this.serviceId(), file, {
            onPhase: (phase) => this.busyLabel.set(`${PHASE_LABEL[phase]} ${file.name}`)
          });
          current = [...current, created];
          this.changed.emit(current);
        } catch (err) {
          errors.push(`${file.name}: ${this.messageOf(err)}`);
        }
      }
    } finally {
      this.busy.set(false);
      this.busyLabel.set('');
    }
    if (errors.length > 0) {
      this.error.set(errors.join(' '));
    }
  }

  // ------------------------------------------------------------ reemplazar

  /** El botón "Reemplazar" abre el selector de archivos; el archivo elegido llega a onReplaceSelected. */
  startReplace(attachment: ProposalServiceAttachment, picker: HTMLInputElement): void {
    if (this.busy()) {
      return;
    }
    this.replaceTarget = attachment;
    picker.click();
  }

  async onReplaceSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    const target = this.replaceTarget;
    this.replaceTarget = null;
    if (!file || !target || this.busy()) {
      return;
    }
    this.error.set(null);
    const invalid = validateAttachmentFile(file);
    if (invalid) {
      this.error.set(`${file.name}: ${invalid}`);
      return;
    }
    this.busy.set(true);
    this.busyId.set(target.id);
    try {
      const updated = await this.attachmentsService.upload(this.proposalId(), this.serviceId(), file, {
        replaceId: target.id,
        onPhase: (phase) => this.busyLabel.set(`${PHASE_LABEL[phase]} ${file.name}`)
      });
      this.changed.emit(this.attachments().map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      // El documento anterior sigue intacto: el servidor solo lo reemplaza cuando el nuevo ya está validado.
      this.error.set(`No se pudo reemplazar «${target.fileName}»: ${this.messageOf(err)} El archivo anterior sigue disponible.`);
    } finally {
      this.busy.set(false);
      this.busyId.set(null);
      this.busyLabel.set('');
    }
  }

  // ------------------------------------------------------------ visibilidad

  async onToggleVisible(attachment: ProposalServiceAttachment, event: Event): Promise<void> {
    const box = event.target as HTMLInputElement;
    const wanted = box.checked;
    if (this.busy()) {
      box.checked = attachment.visibleToClient;
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    this.busyId.set(attachment.id);
    this.busyLabel.set('Guardando…');
    try {
      const updated = await this.attachmentsService.setVisibility(attachment.id, wanted);
      this.changed.emit(this.attachments().map((a) => (a.id === updated.id ? updated : a)));
    } catch (err) {
      box.checked = attachment.visibleToClient;
      this.error.set(`No se pudo cambiar la visibilidad: ${this.messageOf(err)}`);
    } finally {
      this.busy.set(false);
      this.busyId.set(null);
      this.busyLabel.set('');
    }
  }

  // ------------------------------------------------------------ abrir

  async open(attachment: ProposalServiceAttachment, download = false): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.error.set(null);
    // La pestaña se abre ya (dentro del clic) para que los navegadores móviles no la bloqueen; luego recibe la URL.
    const tab = download ? null : window.open('', '_blank');
    if (tab) {
      tab.opener = null;
    }
    this.busy.set(true);
    this.busyId.set(attachment.id);
    this.busyLabel.set('Abriendo…');
    try {
      const url = await this.attachmentsService.getUrl(attachment.id, download);
      if (tab) {
        tab.location.href = await resolveViewableUrl(url, attachment.mimeType);
      } else {
        const link = document.createElement('a');
        link.href = url;
        link.rel = 'noopener';
        link.click();
      }
    } catch (err) {
      tab?.close();
      this.error.set(`No se pudo abrir el documento: ${this.messageOf(err)}`);
    } finally {
      this.busy.set(false);
      this.busyId.set(null);
      this.busyLabel.set('');
    }
  }

  // ------------------------------------------------------------ eliminar

  requestDelete(attachment: ProposalServiceAttachment): void {
    if (!this.busy()) {
      this.pendingDelete.set(attachment);
    }
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.pendingDelete();
    this.pendingDelete.set(null);
    if (!target || this.busy()) {
      return;
    }
    this.error.set(null);
    this.busy.set(true);
    this.busyId.set(target.id);
    this.busyLabel.set('Eliminando…');
    try {
      await this.attachmentsService.delete(target.id);
      this.changed.emit(this.attachments().filter((a) => a.id !== target.id));
    } catch (err) {
      // La fila se conserva si Storage falló: el documento sigue en la lista y se puede reintentar.
      this.error.set(`No se pudo eliminar «${target.fileName}»: ${this.messageOf(err)}`);
    } finally {
      this.busy.set(false);
      this.busyId.set(null);
      this.busyLabel.set('');
    }
  }

  private messageOf(err: unknown): string {
    if (err instanceof AttachmentApiError || err instanceof Error) {
      return err.message;
    }
    return 'Inténtalo de nuevo.';
  }
}
