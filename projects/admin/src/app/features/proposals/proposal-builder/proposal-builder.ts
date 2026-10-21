import { Component, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { DatePipe, Location } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProposalsService } from '../../../core/services/proposals';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { Proposal } from '../../../core/models/proposal.model';
import { PROPOSAL_STATUS_LABEL } from '../../../core/models/proposal-enums';
import { PublishProblem, isPublishTab, pendingLabel, problemAnchorId, scrollToAnchor } from '../../../core/models/publish-readiness';
import { environment } from '../../../../environments/environment';
import { ClientTripStep } from './client-trip-step/client-trip-step';
import { BuildJourneyStep } from './build-journey-step/build-journey-step';
import { PricingStep } from './pricing-step/pricing-step';
import { TravelTipsStep } from './travel-tips-step/travel-tips-step';
import { AiPolishStep } from './ai-polish-step/ai-polish-step';
import { PreviewStep } from './preview-step/preview-step';
import { PublishChecklist } from './publish-checklist/publish-checklist';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';
import { can } from '../../../core/data/permissions';
import { BuilderStep, injectTravelMode, travelConfigOf } from '../../travel/travel-config';

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
type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

/** Mensajes que publish_proposal() lanza a propósito (en español, pensados para la asesora). */
const PUBLISH_USER_MESSAGES = ['Faltan datos para publicar', 'Solo se puede publicar', 'No autorizado', 'Propuesta no encontrada'];

/** Supabase devuelve los errores de la base como objetos simples (no `Error`): el motivo está en `.message`. */
function publishErrorMessage(error: unknown): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && PUBLISH_USER_MESSAGES.some((prefix) => message.startsWith(prefix))) {
    return message;
  }
  return 'No se pudo publicar la propuesta. Inténtalo nuevamente.';
}

@Component({
  selector: 'app-proposal-builder',
  imports: [RouterLink, DatePipe, ClientTripStep, BuildJourneyStep, PricingStep, TravelTipsStep, AiPolishStep, PreviewStep, PublishChecklist, ConfirmDialog, AdminModal],
  templateUrl: './proposal-builder.html',
  styleUrl: './proposal-builder.css'
})
export class ProposalBuilder {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly proposalsService = inject(ProposalsService);
  private readonly leadsService = inject(LeadsService);
  private readonly auth = inject(AuthService);
  private readonly menuRef = viewChild<ElementRef<HTMLElement>>('menu');

  /** Propuesta o Itinerario según la ruta: pestañas, acciones de cabecera y vista previa salen de la configuración del modo. */
  readonly mode = injectTravelMode();
  readonly config = travelConfigOf(this.mode);
  readonly caps = this.config.capabilities;
  /** Eliminar es solo de admin (igual que la RLS). */
  readonly canRemove = computed(() => can(this.auth.profile()?.role, this.config.permissions.remove));
  readonly routeBase = this.config.routeBase;
  readonly tabs = computed(() => this.config.tabs.filter((tab) => !tab.permission || can(this.auth.profile()?.role, tab.permission)));
  readonly statusLabel = PROPOSAL_STATUS_LABEL;
  readonly proposalId = this.route.snapshot.paramMap.get('id')!;

  readonly proposal = signal<Proposal | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly publishing = signal(false);
  readonly publishError = signal<string | null>(null);

  // --- Pendientes para publicar: los calcula la base (get_publish_readiness), la misma función que usa
  // publish_proposal. null = no se pudo saber (p. ej. migración sin aplicar): entonces no se bloquea nada
  // y la base sigue decidiendo al publicar.
  readonly readiness = signal<PublishProblem[] | null>(null);
  readonly pendingCount = computed(() => this.readiness()?.length ?? 0);
  readonly publishBlocked = computed(() => this.pendingCount() > 0);
  readonly pendingLabel = computed(() => pendingLabel(this.pendingCount()));
  private readinessSeq = 0;
  readonly linkCopied = signal(false);

  // --- Envio por WhatsApp: el enlace y el codigo salen del navegador de la
  // asesora directo a wa.me; el codigo NUNCA pasa por nuestro servidor (solo se
  // guarda su hash, asi que hay que pegarlo o haberlo generado en esta sesion).
  readonly whatsappOpen = signal(false);
  readonly whatsappPhone = signal('');
  readonly whatsappCode = signal('');
  readonly whatsappCopied = signal(false);
  private lastGeneratedCode = '';

  onCodeGenerated(code: string): void {
    this.lastGeneratedCode = code;
    // Generar el código no emite «guardado»: se vuelve a calcular qué falta.
    void this.refreshReadiness();
  }

  readonly whatsappNeedsCode = computed(() => this.proposal()?.accessRequired === true);

  readonly whatsappMessage = computed(() => {
    const p = this.proposal();
    const link = this.privateLink();
    if (!p || !link) {
      return '';
    }
    const firstName = (p.clientName ?? '').trim().split(' ')[0];
    const advisor = this.auth.profile()?.fullName ?? 'tu asesora';
    const code = this.whatsappCode().trim();
    const lines = [
      `Hola${firstName ? ' ' + firstName : ''}, soy ${advisor} de The Travel Edit. Tu propuesta de viaje está lista ✨`,
      '',
      `Ábrela aquí: ${link}`
    ];
    if (this.whatsappNeedsCode()) {
      lines.push('', `Tu código de acceso: ${code || '(escríbelo aquí)'}`);
    }
    lines.push('', 'Si quieres ajustar algo, respóndeme por este medio.');
    return lines.join('\n');
  });

  readonly whatsappUrl = computed(() => {
    const digits = this.whatsappPhone().replace(/\D/g, '');
    return `https://wa.me/${digits}?text=${encodeURIComponent(this.whatsappMessage())}`;
  });

  readonly whatsappReady = computed(() => !this.whatsappNeedsCode() || this.whatsappCode().trim().length > 0);

  async openWhatsapp(): Promise<void> {
    this.menuOpen.set(false);
    this.whatsappCode.set(this.lastGeneratedCode);
    this.whatsappCopied.set(false);
    this.whatsappOpen.set(true);
    const leadId = this.proposal()?.leadId;
    if (leadId && !this.whatsappPhone()) {
      try {
        const lead = await this.leadsService.getById(leadId);
        this.whatsappPhone.set(lead?.phone ?? '');
      } catch (error) {
        console.error('No se pudo cargar el teléfono de la solicitud.', error);
      }
    }
  }

  closeWhatsapp(): void {
    this.whatsappOpen.set(false);
  }

  onWhatsappPhoneInput(event: Event): void {
    this.whatsappPhone.set((event.target as HTMLInputElement).value);
  }

  onWhatsappCodeInput(event: Event): void {
    this.whatsappCode.set((event.target as HTMLInputElement).value);
  }

  async copyWhatsappMessage(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.whatsappMessage());
      this.whatsappCopied.set(true);
      setTimeout(() => this.whatsappCopied.set(false), 2000);
    } catch (error) {
      console.error('No se pudo copiar el mensaje.', error);
    }
  }

  sendWhatsapp(): void {
    if (!this.whatsappReady()) {
      return;
    }
    window.open(this.whatsappUrl(), '_blank', 'noopener');
    this.whatsappOpen.set(false);
  }

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
    // En producción publicSiteUrl es "" (admin y sitio comparten dominio), lo que daba
    // una ruta relativa ("/private/…"): al copiarla y pegarla en el navegador no
    // abre nada. El enlace que se comparte siempre tiene que ser absoluto.
    const base = environment.publicSiteUrl || window.location.origin;
    return token ? `${base}/private/${token}` : null;
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
    // Solo pasos que el modo ofrece (y que la persona puede ver): un ?step=pricing en un itinerario cae en el primero.
    const valid: BuilderStep[] = [...this.tabs().map((tab) => tab.key), ...(this.caps.previewPanel ? (['preview'] as const) : [])];
    return (valid as string[]).includes(value ?? '') ? (value as BuilderStep) : 'client-trip';
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.proposal.set(await this.proposalsService.getById(this.proposalId));
      void this.refreshReadiness();
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
    await this.refreshReadiness();
  }

  /** Vuelve a pedir a la base qué falta para publicar. Solo la última respuesta cuenta. */
  async refreshReadiness(): Promise<void> {
    const seq = ++this.readinessSeq;
    if (!this.caps.publish || this.proposal()?.status !== 'draft') {
      this.readiness.set(null);
      return;
    }
    const problems = await this.proposalsService.getPublishReadiness(this.proposalId);
    if (seq === this.readinessSeq) {
      this.readiness.set(problems);
    }
  }

  /** Abre la pestaña del pendiente y, si se sabe, lleva al campo, día, servicio o línea exacta. */
  goToProblem(problem: PublishProblem): void {
    this.goToStep(isPublishTab(problem.tab) ? problem.tab : 'client-trip');
    scrollToAnchor(problemAnchorId(problem));
  }

  /** Con pendientes, publicar no llama a la base: se lleva la atención a la lista. */
  private showChecklist(): void {
    this.menuOpen.set(false);
    const list = document.getElementById('publish-checklist');
    list?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    list?.focus({ preventScroll: true });
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
    // serializeUrl no incluye el <base href>: el admin se sirve bajo /admin/ en producción, y sin ese prefijo la pestaña
    // nueva cae en la web pública (página principal). prepareExternalUrl lo agrega (en desarrollo, con base "/", no cambia).
    window.open(this.location.prepareExternalUrl(url), '_blank', 'noopener');
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
      await this.router.navigateByUrl(this.routeBase);
    } catch (error) {
      console.error('No se pudo eliminar la propuesta.', error);
      this.deleteError.set(this.config.labels.deleteError);
    } finally {
      this.deleting.set(false);
    }
  }

  async publish(): Promise<void> {
    if (this.publishing()) {
      return;
    }
    if (this.publishBlocked()) {
      this.showChecklist();
      return;
    }
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      await this.proposalsService.publish(this.proposalId);
      await this.onSaved();
    } catch (error) {
      console.error('No se pudo publicar la propuesta.', error);
      this.publishError.set(publishErrorMessage(error));
    } finally {
      this.publishing.set(false);
    }
  }

  /** Un solo clic: publica y, si se publicó bien, manda el correo. Si el envío
   *  falla (p. ej. falta el correo del cliente) la propuesta queda publicada y
   *  el error se muestra con "Reintentar envío". */
  async publishAndSend(): Promise<void> {
    if (this.publishing() || this.sendingToClient()) {
      return;
    }
    if (this.publishBlocked()) {
      // Importante: sin esto, publish() volvería sin error y se enviaría el correo de una propuesta sin publicar.
      this.showChecklist();
      return;
    }
    this.menuOpen.set(false);
    await this.publish();
    if (!this.publishError()) {
      await this.sendToClient();
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
