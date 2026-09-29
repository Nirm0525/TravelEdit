import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { PublicProposalService, ProposalAccessResult, ProposalGateResponse, PublicProposalData } from '../../core/services/public-proposal';
import { PROPOSAL_SERVICE_TYPE_LABEL } from '../../core/models/proposal-enums-public';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';

type Phase = 'loading' | 'unavailable' | 'gate' | 'content';

const SESSION_PREFIX = 'te-proposal-session:';

interface StoredSession {
  sessionToken: string;
  expiresAt: string | null;
}

interface NavSection {
  id: string;
  label: string;
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/**
 * "12–18 enero 2027" si cae en el mismo mes/año; "28 dic 2026 – 3 ene 2027"
 * si cruza mes o año — nunca se muestra si falta una de las dos fechas (ver
 * tripSummary/heroDates: no se inventa una fecha faltante con la otra).
 */
function formatDateRange(startIso: string, endIso: string): string {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${MESES[start.getMonth()]} ${start.getFullYear()}`;
  }
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = sameYear ? `${start.getDate()} ${shortMonth(start)}` : `${start.getDate()} ${shortMonth(start)} ${start.getFullYear()}`;
  const endLabel = `${end.getDate()} ${shortMonth(end)} ${end.getFullYear()}`;
  return `${startLabel} – ${endLabel}`;
}

function shortMonth(date: Date): string {
  return MESES[date.getMonth()].slice(0, 3);
}

/**
 * Solo cuenta noches cuando AMBAS fechas son reales y end > start — nunca se
 * inventa una duración a partir de una sola fecha o de datos ambiguos.
 */
function nightsBetween(startIso: string, endIso: string): number | null {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diffDays > 0 ? diffDays : null;
}

/**
 * /private/:token — nunca renderiza contenido de la propuesta sin una
 * sesión válida. El token de la URL por sí solo no alcanza (ver
 * PublicProposalService): primero getProposalGate (lo mínimo para pintar la
 * pantalla de código), luego verifyAccess (emite la sesión), recién
 * entonces getContent. La sesión se guarda en sessionStorage — nunca el
 * código, nunca un hash — y se pierde al cerrar la pestaña, a propósito
 * (contenido para clientes VIP, no algo que deba sobrevivir indefinido en
 * el navegador).
 */
@Component({
  selector: 'app-private-proposal',
  imports: [DatePipe, CurrencyPipe, RevealOnScrollDirective],
  templateUrl: './private-proposal.html',
  styleUrl: './private-proposal.css'
})
export class PrivateProposal {
  private readonly publicProposal = inject(PublicProposalService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly sanitizer = inject(DomSanitizer);

  readonly token = input.required<string>();
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;

  readonly phase = signal<Phase>('loading');
  readonly gate = signal<ProposalGateResponse | null>(null);
  readonly data = signal<PublicProposalData | null>(null);
  /** Fade/reveal sutil al desbloquear (ver sección 4 de la spec) — arranca
   *  en false y se prende un tick después de entrar a 'content', nunca al
   *  revés, así CSS puede animar de 0→1 con una sola transición simple sin
   *  depender de que GSAP se re-dispare. Reduced-motion lo ignora vía CSS
   *  (transition-duration: 0 ya aplicado globalmente en styles.css). */
  readonly contentRevealed = signal(false);
  private sessionToken: string | null = null;

  readonly codeInput = signal('');
  readonly verifying = signal(false);
  readonly accessError = signal<ProposalAccessResult | null>(null);

  readonly acceptedByName = signal('');
  readonly termsChecked = signal(false);
  readonly accepting = signal(false);
  readonly acceptError = signal<string | null>(null);
  readonly justAccepted = signal(false);

  readonly navOpen = signal(false);
  readonly activeSectionId = signal<string | null>(null);

  // Angular's [innerHTML] sanitizer strips every `style` attribute outright
  // (mismo problema ya resuelto en article-detail.ts) — sanitizeRichHtml()
  // hace su propio pase de allow-list antes, así que confiar en su salida acá
  // no es saltarse la sanitización, es reemplazar el borrado a lo bruto de
  // Angular por uno dirigido que igual deja el contenido peligroso afuera.
  readonly safeIntroBody = computed<SafeHtml | null>(() => {
    const body = this.data()?.content.intro.body;
    return body ? this.sanitizer.bypassSecurityTrustHtml(sanitizeRichHtml(body)) : null;
  });

  readonly safeTermsBody = computed<SafeHtml | null>(() => {
    const body = this.data()?.content.terms.body;
    return body ? this.sanitizer.bypassSecurityTrustHtml(sanitizeRichHtml(body)) : null;
  });

  /** Badge de destino del hero ("ROATÁN, HONDURAS") — mayúsculas simples
   *  sobre destination_text tal cual está guardado; nunca se parte en
   *  ciudad/país porque no existen como campos separados. */
  readonly destinationBadge = computed<string | null>(() => {
    const text = this.data()?.destinationText;
    return text ? text.toUpperCase() : null;
  });

  readonly datesLabel = computed<string | null>(() => {
    const d = this.data();
    if (!d?.startDate || !d?.endDate) {
      return null;
    }
    return formatDateRange(d.startDate, d.endDate);
  });

  readonly durationLabel = computed<string | null>(() => {
    const d = this.data();
    if (!d?.startDate || !d?.endDate) {
      return null;
    }
    const nights = nightsBetween(d.startDate, d.endDate);
    if (nights === null) {
      return null;
    }
    return `${nights + 1} días / ${nights} noche${nights === 1 ? '' : 's'}`;
  });

  readonly travelersLabel = computed<string | null>(() => {
    const count = this.data()?.travelersCount;
    return count && count > 0 ? `${count} viajero${count === 1 ? '' : 's'}` : null;
  });

  /** Ninguno de estos 4 datos se inventa si falta — el resumen del viaje
   *  simplemente omite la fila correspondiente (ver sección 8 de la spec:
   *  "No inventar noches si no puede calcularse con certeza"). */
  readonly hasTripSummary = computed<boolean>(
    () => !!(this.destinationBadge() || this.datesLabel() || this.durationLabel() || this.travelersLabel())
  );

  /** Nav interna — solo lista secciones que realmente tienen contenido, para
   *  no ofrecer un link muerto a "Servicios" en una propuesta sin días. */
  readonly navSections = computed<NavSection[]>(() => {
    const d = this.data();
    if (!d) {
      return [];
    }
    const sections: NavSection[] = [];
    if (d.content.intro.headline || d.content.intro.body) {
      sections.push({ id: 'resumen', label: 'Resumen' });
    }
    if (d.content.days.length > 0) {
      sections.push({ id: 'itinerario', label: 'Itinerario' });
    }
    if (d.content.pricing.lines.length > 0 || d.content.pricing.feesLines.length > 0) {
      sections.push({ id: 'inversion', label: 'Inversión' });
    }
    if (d.content.terms.body) {
      sections.push({ id: 'terminos', label: 'Términos' });
    }
    return sections;
  });

  constructor() {
    this.title.setTitle('Propuesta privada | The Travel Edit');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

    // El token viene del router (withComponentInputBinding) y todavía no
    // tiene valor en el primer tick del constructor — leerlo fuera de un
    // effect() dispara NG0950, mismo motivo que en article-detail.ts.
    effect(() => {
      void this.init(this.token());
    });
  }

  private async init(token: string): Promise<void> {
    this.phase.set('loading');
    this.contentRevealed.set(false);

    let gate: ProposalGateResponse | null;
    try {
      gate = await this.publicProposal.getProposalGate(token);
    } catch (error) {
      console.error('No se pudo cargar la propuesta.', error);
      gate = null;
    }

    if (!gate) {
      this.phase.set('unavailable');
      return;
    }
    this.gate.set(gate);

    const stored = this.readStoredSession(token);
    if (stored && (await this.loadContent(token, stored.sessionToken))) {
      return;
    }
    if (stored) {
      this.clearStoredSession(token);
    }

    if (!gate.accessRequired) {
      await this.attemptVerify(token, null);
      return;
    }

    // Probe silencioso: distingue "todavía no se configuró ningún código"
    // (pantalla de no disponible) de "sí hay código, falta que lo escriban"
    // (pantalla de acceso) — sin esto, a una propuesta con access_required
    // pero sin código nunca configurado se le mostraría un formulario que
    // jamás podría funcionar. No cuenta como intento fallido: la rama
    // access_not_configured de verify_proposal_access() no toca
    // access_attempts (ver supabase/migrations/0035_proposal_access_credentials.sql).
    const probe = await this.publicProposal.verifyAccess(token, null);
    if (probe.result === 'access_not_configured') {
      this.phase.set('unavailable');
      return;
    }

    this.phase.set('gate');
  }

  private async loadContent(token: string, sessionToken: string): Promise<boolean> {
    try {
      const data = await this.publicProposal.getContent(token, sessionToken);
      this.data.set(data);
      this.sessionToken = sessionToken;
      this.phase.set('content');
      // Un tick después de montar el contenido, no en el mismo — así el CSS
      // de transición (opacity/transform) tiene un estado inicial real desde
      // el que animar en vez de arrancar ya en el estado final.
      setTimeout(() => this.contentRevealed.set(true), 20);
      return true;
    } catch (error) {
      console.error('Sesión inválida o expirada.', error);
      return false;
    }
  }

  onCodeInput(event: Event): void {
    this.codeInput.set((event.target as HTMLInputElement).value);
  }

  async submitCode(): Promise<void> {
    const token = this.token();
    const code = this.codeInput().trim();
    if (!code || this.verifying()) {
      return;
    }
    await this.attemptVerify(token, code);
  }

  private async attemptVerify(token: string, code: string | null): Promise<void> {
    this.verifying.set(true);
    this.accessError.set(null);
    try {
      const res = await this.publicProposal.verifyAccess(token, code);
      if (res.result === 'ok' && res.sessionToken) {
        this.codeInput.set('');
        this.storeSession(token, res.sessionToken, res.sessionExpiresAt);
        const loaded = await this.loadContent(token, res.sessionToken);
        if (!loaded) {
          this.phase.set('unavailable');
        }
      } else {
        this.codeInput.set('');
        this.accessError.set(res.result);
        this.phase.set('gate');
      }
    } catch (error) {
      console.error('No se pudo verificar el acceso.', error);
      this.accessError.set('not_found');
      this.phase.set('gate');
    } finally {
      this.verifying.set(false);
    }
  }

  onAcceptedByNameInput(event: Event): void {
    this.acceptedByName.set((event.target as HTMLInputElement).value);
  }

  toggleTermsChecked(event: Event): void {
    this.termsChecked.set((event.target as HTMLInputElement).checked);
  }

  canAccept(): boolean {
    return this.acceptedByName().trim().length > 0 && this.termsChecked() && !this.accepting();
  }

  async accept(): Promise<void> {
    const token = this.token();
    const session = this.sessionToken;
    if (!session || !this.canAccept()) {
      return;
    }
    this.accepting.set(true);
    this.acceptError.set(null);
    try {
      await this.publicProposal.acceptProposal(token, session, this.acceptedByName().trim());
      await this.loadContent(token, session);
      this.justAccepted.set(true);
    } catch (error) {
      console.error('No se pudo confirmar la aceptación.', error);
      this.acceptError.set('No se pudo confirmar. Intenta de nuevo en unos segundos.');
    } finally {
      this.accepting.set(false);
    }
  }

  toggleNav(): void {
    this.navOpen.update((open) => !open);
  }

  scrollToSection(id: string): void {
    this.navOpen.set(false);
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private storageKey(token: string): string {
    return `${SESSION_PREFIX}${token}`;
  }

  private storeSession(token: string, sessionToken: string, expiresAt: string | null): void {
    try {
      const value: StoredSession = { sessionToken, expiresAt };
      sessionStorage.setItem(this.storageKey(token), JSON.stringify(value));
    } catch {
      // Almacenamiento no disponible (ventana privada, cuotas, etc.) — la
      // propuesta sigue funcionando, solo se pedirá el código de nuevo si
      // se recarga la página.
    }
  }

  private readStoredSession(token: string): StoredSession | null {
    try {
      const raw = sessionStorage.getItem(this.storageKey(token));
      return raw ? (JSON.parse(raw) as StoredSession) : null;
    } catch {
      return null;
    }
  }

  private clearStoredSession(token: string): void {
    try {
      sessionStorage.removeItem(this.storageKey(token));
    } catch {
      // no-op
    }
  }
}
