import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProposalsService } from '../../../core/services/proposals';
import { Proposal } from '../../../core/models/proposal.model';
import { PROPOSAL_STATUS_LABEL } from '../../../core/models/proposal-enums';
import { environment } from '../../../../environments/environment';
import { ClientTripStep } from './client-trip-step/client-trip-step';
import { BuildJourneyStep } from './build-journey-step/build-journey-step';
import { PricingStep } from './pricing-step/pricing-step';
import { TravelTipsStep } from './travel-tips-step/travel-tips-step';
import { AiPolishStep } from './ai-polish-step/ai-polish-step';
import { PreviewStep } from './preview-step/preview-step';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';

/** 'preview' no es una pestaña visible — la vista previa en vivo es la
 *  columna persistente de la derecha, siempre montada sin importar qué
 *  pestaña esté activa a la izquierda. Sigue existiendo como valor válido de
 *  currentStep únicamente para la ruta oculta de página completa que usan
 *  "Abrir en nueva pestaña" y el link de proposals-list.html (?step=preview).
 *
 *  'assistant' es una pestaña más como cualquier otra — un solo tab activo a
 *  la vez, y su contenido (el chat de The Edit Assistant) ocupa la MISMA
 *  columna izquierda que el resto de los formularios, nunca una columna
 *  extra al costado. Corregido en QA real: antes convivía como panel lateral
 *  y además el tab "Client & Trip" quedaba resaltado a la vez que "Portada"/
 *  "Términos" porque ClientTripStep comparte esas tres secciones — con un
 *  solo currentStep gobernando tanto el contenido como el resaltado de la
 *  pestaña, eso ya no puede pasar. */
type BuilderStep = 'client-trip' | 'cover' | 'journey' | 'pricing' | 'travel-tips' | 'terms' | 'assistant' | 'preview';
type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

interface TabDef {
  key: BuilderStep;
  label: string;
}

const TABS: TabDef[] = [
  { key: 'client-trip', label: 'Client & Trip' },
  { key: 'cover', label: 'Portada' },
  { key: 'journey', label: 'Itinerario' },
  { key: 'pricing', label: 'Precios' },
  { key: 'travel-tips', label: 'Travel Tips' },
  { key: 'terms', label: 'Términos' },
  { key: 'assistant', label: 'The Edit Assistant' }
];

@Component({
  selector: 'app-proposal-builder',
  imports: [RouterLink, DatePipe, ClientTripStep, BuildJourneyStep, PricingStep, TravelTipsStep, AiPolishStep, PreviewStep, ConfirmDialog],
  templateUrl: './proposal-builder.html',
  styleUrl: './proposal-builder.css'
})
export class ProposalBuilder {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly proposalsService = inject(ProposalsService);
  private readonly menuRef = viewChild<ElementRef<HTMLElement>>('menu');

  readonly tabs = TABS;
  readonly statusLabel = PROPOSAL_STATUS_LABEL;
  readonly proposalId = this.route.snapshot.paramMap.get('id')!;

  readonly proposal = signal<Proposal | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly publishing = signal(false);
  readonly publishError = signal<string | null>(null);
  readonly linkCopied = signal(false);

  readonly sendingToClient = signal(false);
  readonly sendError = signal<string | null>(null);
  readonly sendSuccess = signal<{ sentTo: string } | null>(null);

  readonly menuOpen = signal(false);
  readonly deletePending = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly previewDevice = signal<PreviewDevice>('desktop');
  readonly previewDrawerOpen = signal(false);
  /** Breve resaltado del borde de la columna de preview — sin esto, el botón
   *  "Vista previa" del header no producía ningún cambio visible en pantallas
   *  anchas (la columna ya está siempre visible ahí, solo se activa el
   *  drawer angosto que en desktop no pinta nada): un click sin feedback se
   *  lee como "el botón no funciona" aunque el estado sí cambiaba. */
  readonly previewFlash = signal(false);
  private readonly previewColRef = viewChild<ElementRef<HTMLElement>>('previewCol');
  /** Cada guardado real (de cualquier paso, incluido el Assistant) incrementa
   *  esto — la columna de preview lo usa para recargar sin compartir estado
   *  con el paso activo. */
  readonly refreshTick = signal(0);

  /** Target key a preseleccionar cuando un botón ✨ contextual de otro paso
   *  navega a la pestaña "The Edit Assistant". */
  readonly assistantPreset = signal<string | null>(null);

  readonly currentStep = signal<BuilderStep>(this.readStepFromUrl());

  readonly isFullPagePreview = computed(() => this.currentStep() === 'preview');

  readonly privateLink = computed(() => {
    const token = this.proposal()?.publicToken;
    return token ? `${environment.publicSiteUrl}/private/${token}` : null;
  });

  constructor() {
    void this.load();
  }

  /** Misma derivación que lead-detail.ts (ticketRef) — un identificador
   *  legible y estable a partir del UUID, no un número de ticket real. Se
   *  recalcula acá en vez de traer el lead completo solo para mostrar el
   *  link de vuelta. */
  leadTicketRef(leadId: string): string {
    return `TE-${leadId.slice(0, 6).toUpperCase()}`;
  }

  private readStepFromUrl(): BuilderStep {
    const value = this.route.snapshot.queryParamMap.get('step');
    const valid: BuilderStep[] = ['client-trip', 'cover', 'journey', 'pricing', 'travel-tips', 'terms', 'assistant', 'preview'];
    return (valid as string[]).includes(value ?? '') ? (value as BuilderStep) : 'client-trip';
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.proposal.set(await this.proposalsService.getById(this.proposalId));
    } catch (error) {
      console.error('No se pudo cargar la propuesta.', error);
      this.loadError.set('No se pudo cargar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Los pasos hijos llaman esto después de guardar — el header (nombre,
   *  status, última actualización) y la columna de preview siempre ven el
   *  estado real que Supabase acaba de recalcular.
   *
   *  Bug real encontrado en QA: esto llamaba a load(), que empieza con
   *  loading.set(true). El template raíz es
   *  @if (loading()) {...} @else if (...) {...} @else if (proposal(); as p)
   *  { <TODO el panel de edición> } — poner loading en true desmonta esa
   *  rama entera y recrea CADA hijo (client-trip-step, build-journey-step,
   *  ai-polish-step...) desde cero en cuanto el fetch resuelve. Invisible
   *  mientras el Assistant no tenía estado propio que perder, pero con el
   *  chat esto borraba toda la conversación después de cada "Aplicar". Un
   *  refresco en segundo plano nunca debe desmontar el árbol activo. */
  async onSaved(): Promise<void> {
    await this.refreshProposal();
    this.refreshTick.update((n) => n + 1);
  }

  private async refreshProposal(): Promise<void> {
    try {
      this.proposal.set(await this.proposalsService.getById(this.proposalId));
    } catch (error) {
      console.error('No se pudo actualizar la propuesta.', error);
    }
  }

  goToStep(step: BuilderStep): void {
    this.currentStep.set(step);
    this.menuOpen.set(false);
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { step },
      queryParamsHandling: 'merge',
      replaceUrl: true
    });
  }

  isTabActive(key: BuilderStep): boolean {
    return this.currentStep() === key;
  }

  /** Botón ✨ contextual en un campo del formulario: navega a la pestaña "The
   *  Edit Assistant" con esa sección ya preseleccionada. Nunca llama a
   *  OpenAI por sí solo — el agente todavía tiene que enviar el mensaje. */
  activateAssistant(targetKey: string): void {
    this.assistantPreset.set(targetKey);
    this.goToStep('assistant');
  }

  /** Botón "Ir a Itinerario" que The Edit Assistant muestra cuando el agente
   *  pide un día que todavía no existe. */
  goToItineraryFromAssistant(): void {
    this.goToStep('journey');
  }

  setPreviewDevice(device: PreviewDevice): void {
    this.previewDevice.set(device);
  }

  openPreviewInNewTab(): void {
    const url = this.router.serializeUrl(
      this.router.createUrlTree([], { relativeTo: this.route, queryParams: { step: 'preview' } })
    );
    window.open(url, '_blank', 'noopener');
  }

  /** Un solo botón que siempre hace algo visible: en pantallas angostas abre
   *  el drawer (como antes); en pantallas anchas, donde la columna ya está
   *  visible, hace scroll hasta ella y la resalta un instante — nunca un
   *  click "silencioso". */
  togglePreviewDrawer(): void {
    this.previewDrawerOpen.update((open) => !open);
    this.previewColRef()?.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    this.previewFlash.set(true);
    setTimeout(() => this.previewFlash.set(false), 900);
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.menuOpen()) {
      return;
    }
    const el = this.menuRef()?.nativeElement;
    if (el && !el.contains(event.target as Node)) {
      this.menuOpen.set(false);
    }
  }

  requestDelete(): void {
    this.menuOpen.set(false);
    this.deleteError.set(null);
    this.deletePending.set(true);
  }

  cancelDelete(): void {
    this.deletePending.set(false);
  }

  async confirmDelete(): Promise<void> {
    if (this.deleting()) {
      return;
    }
    this.deletePending.set(false);
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.proposalsService.remove(this.proposalId);
      await this.router.navigateByUrl('/proposals');
    } catch (error) {
      console.error('No se pudo eliminar la propuesta.', error);
      this.deleteError.set('No se pudo eliminar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.deleting.set(false);
    }
  }

  async publish(): Promise<void> {
    if (this.publishing()) {
      return;
    }
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.proposalsService.publish(this.proposalId);
      await this.onSaved();
    } catch (error) {
      console.error('No se pudo publicar la propuesta.', error);
      this.publishError.set(error instanceof Error ? error.message : 'No se pudo publicar la propuesta.');
    } finally {
      this.publishing.set(false);
    }
  }

  async unpublish(): Promise<void> {
    if (this.publishing()) {
      return;
    }
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.proposalsService.unpublish(this.proposalId);
      await this.onSaved();
    } catch (error) {
      console.error('No se pudo despublicar la propuesta.', error);
      this.publishError.set('No se pudo despublicar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.publishing.set(false);
    }
  }

  async copyLink(): Promise<void> {
    const link = this.privateLink();
    if (!link) {
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      this.linkCopied.set(true);
      setTimeout(() => this.linkCopied.set(false), 2000);
    } catch (error) {
      console.error('No se pudo copiar el enlace.', error);
    }
  }

  /** Crear el draft, publicar o copiar el link NUNCA tocan el lead — según
   *  la sección N de la spec, el único disparador real de "propuesta
   *  enviada" es este método, y solo cuando el correo se manda con éxito
   *  (la Edge Function hace esa transición server-side, no Angular). */
  async sendToClient(): Promise<void> {
    if (this.sendingToClient()) {
      return;
    }
    this.sendingToClient.set(true);
    this.sendError.set(null);
    this.sendSuccess.set(null);
    this.menuOpen.set(false);
    try {
      const result = await this.proposalsService.sendToClient(this.proposalId);
      this.sendSuccess.set({ sentTo: result.sentTo });
    } catch (error) {
      console.error('No se pudo enviar la propuesta al cliente.', error);
      this.sendError.set(error instanceof Error ? error.message : 'No se pudo enviar la propuesta.');
    } finally {
      this.sendingToClient.set(false);
    }
  }
}
