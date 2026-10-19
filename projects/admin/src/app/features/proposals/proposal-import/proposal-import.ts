import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { LeadOption, OriginChannel, ProposalImportService } from '../../../core/services/proposal-import';
import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { pollImportStatus, validatePdfFile } from '../../../core/utils/pdf-import';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { ImportPreview, buildPreview, formatMoney } from './proposal-import-preview';

type Stage = 'form' | 'working' | 'failed' | 'ready';
type WorkingStep = 'uploading' | 'reading';

const CHANNEL_OPTIONS: { value: OriginChannel; label: string }[] = [
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Correo' },
  { value: 'phone', label: 'Teléfono' },
  { value: 'referral', label: 'Referido' },
  { value: 'web', label: 'Sitio web' },
  { value: 'other', label: 'Otro' }
];

/**
 * "Nueva desde PDF": la asesora sube un PDF, ve lo que extrajo The Edit Assistant y crea con un clic una
 * propuesta en borrador. Solo modo "nueva" (importar a una propuesta existente no existe todavía).
 * El nombre original del archivo solo se muestra aquí; nunca interviene en la ruta de Storage.
 */
@Component({
  selector: 'app-proposal-import',
  imports: [RouterLink, AdminPageHeader],
  templateUrl: './proposal-import.html',
  styleUrl: './proposal-import.css'
})
export class ProposalImport implements OnInit {
  private readonly importService = inject(ProposalImportService);
  private readonly router = inject(Router);
  private destroyed = false;

  readonly channelOptions = CHANNEL_OPTIONS;
  readonly formatMoney = formatMoney;

  readonly stage = signal<Stage>('form');
  readonly step = signal<WorkingStep>('uploading');

  // --- formulario ---
  readonly file = signal<File | null>(null);
  readonly fileError = signal<string | null>(null);
  readonly dragging = signal(false);
  readonly channel = signal<OriginChannel | ''>('');
  readonly leadId = signal('');
  readonly leads = signal<LeadOption[]>([]);

  // --- proceso ---
  private importId: string | null = null;
  readonly failureMessage = signal<string | null>(null);
  readonly extracted = signal<StoredExtraction | null>(null);
  readonly preview = computed<ImportPreview | null>(() => {
    const data = this.extracted();
    return data ? buildPreview(data) : null;
  });

  // --- creación ---
  readonly applying = signal(false);
  readonly applyError = signal<string | null>(null);

  /** Con una solicitud vinculada el canal es siempre «Sitio web». */
  readonly effectiveChannel = computed<OriginChannel | ''>(() => (this.leadId() ? 'web' : this.channel()));
  readonly canContinue = computed(() => !!this.file() && !this.fileError() && this.effectiveChannel() !== '');

  constructor() {
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
  }

  async ngOnInit(): Promise<void> {
    try {
      this.leads.set(await this.importService.listLeads());
    } catch (error) {
      // Vincular una solicitud es opcional: sin la lista, la pantalla sigue funcionando.
      console.error('No se pudieron cargar las solicitudes.', error);
    }
  }

  // ---------------------------------------------------------------- archivo

  onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.pickFile(input.files?.[0] ?? null);
    input.value = ''; // permite elegir de nuevo el mismo archivo
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(true);
  }

  onDragLeave(): void {
    this.dragging.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragging.set(false);
    this.pickFile(event.dataTransfer?.files?.[0] ?? null);
  }

  private pickFile(file: File | null): void {
    if (!file) {
      return;
    }
    const problem = validatePdfFile(file);
    this.fileError.set(problem);
    this.file.set(problem ? null : file);
  }

  clearFile(): void {
    this.file.set(null);
    this.fileError.set(null);
  }

  onChannelChange(event: Event): void {
    this.channel.set((event.target as HTMLSelectElement).value as OriginChannel | '');
  }

  onLeadChange(event: Event): void {
    this.leadId.set((event.target as HTMLSelectElement).value);
  }

  // ---------------------------------------------------------------- proceso

  /** Sube el archivo, registra la importación, pide la lectura y espera el resultado. */
  async continue(): Promise<void> {
    const file = this.file();
    if (!file || !this.canContinue()) {
      return;
    }
    this.failureMessage.set(null);
    this.step.set('uploading');
    this.stage.set('working');
    try {
      this.importId = await this.importService.upload(file);
    } catch (error) {
      this.fail(error);
      return;
    }
    await this.readPdf();
  }

  /** «Intentar de nuevo»: vuelve a pedir la lectura (o, si ni siquiera se subió, empieza otra vez). */
  async retry(): Promise<void> {
    if (!this.importId) {
      await this.continue();
      return;
    }
    this.failureMessage.set(null);
    this.stage.set('working');
    await this.readPdf();
  }

  private async readPdf(): Promise<void> {
    const importId = this.importId;
    if (!importId) {
      return;
    }
    this.step.set('reading');
    try {
      await this.importService.start(importId);
      const result = await pollImportStatus(() => this.importService.getStatus(importId), { cancelled: () => this.destroyed });
      if (result === 'cancelled') {
        return;
      }
      if (result === 'timeout') {
        this.failureMessage.set('El PDF está tardando más de lo normal. Puedes volver a intentarlo.');
        this.stage.set('failed');
        return;
      }
      if (result.status === 'ready' && result.extracted) {
        this.extracted.set(result.extracted);
        this.stage.set('ready');
      } else if (result.status === 'applied' && result.proposal_id) {
        await this.router.navigate(['/proposals', result.proposal_id, 'edit']);
      } else {
        this.failureMessage.set(result.error ?? 'No se pudo leer el PDF. Inténtalo de nuevo.');
        this.stage.set('failed');
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    console.error('Falló la importación del PDF.', error);
    this.failureMessage.set(error instanceof Error ? error.message : 'No se pudo procesar el PDF. Inténtalo de nuevo.');
    this.stage.set('failed');
  }

  /** «Elegir otro archivo»: vuelve al formulario (la importación anterior queda sin aplicar). */
  startOver(): void {
    this.importId = null;
    this.extracted.set(null);
    this.failureMessage.set(null);
    this.applyError.set(null);
    this.file.set(null);
    this.fileError.set(null);
    this.stage.set('form');
  }

  // ---------------------------------------------------------------- crear la propuesta

  async createProposal(): Promise<void> {
    const channel = this.effectiveChannel();
    if (!this.importId || channel === '' || this.applying()) {
      return;
    }
    this.applying.set(true);
    this.applyError.set(null);
    try {
      const proposalId = await this.importService.apply(this.importId, channel, this.leadId() || null);
      await this.router.navigate(['/proposals', proposalId, 'edit']);
    } catch (error) {
      console.error('No se pudo crear la propuesta.', error);
      this.applyError.set(error instanceof Error ? error.message : 'No se pudo crear la propuesta. Inténtalo de nuevo.');
    } finally {
      this.applying.set(false);
    }
  }
}
