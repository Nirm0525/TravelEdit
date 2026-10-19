import type { gsap } from 'gsap';
import { Component, ElementRef, OnDestroy, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { CurrencyPipe, DatePipe, DOCUMENT, NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { PROPOSAL_SESSION_PREFIX, PublicProposalService, ProposalAccessResult, ProposalGateResponse, PublicProposalData } from '../../core/services/public-proposal';
import { PROPOSAL_SERVICE_TYPE_LABEL } from '../../core/models/proposal-enums-public';
import { ProposalDay, ProposalServiceType, ProposalTravelTip, ProposalTravelTipGroup } from '../../core/models/proposal-content.model';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { ReducedMotionService } from '../../core/services/reduced-motion';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';
import { Footer } from '../footer/footer';
import { serviceDetailRows } from '../../core/data/proposal-service-fields';
import { buildPricingBreakdown } from '../../core/data/proposal-pricing-breakdown';
import {
  animateItineraryDays,
  moveSidebarIndicator,
  playGateExit,
  playProposalIntro,
  refreshScrollTriggers,
  setupProposalScroll
} from '../../core/gsap/proposal-motion';

type Phase = 'loading' | 'unavailable' | 'gate' | 'content';

const SESSION_PREFIX = PROPOSAL_SESSION_PREFIX;

interface StoredSession {
  sessionToken: string;
  expiresAt: string | null;
}

interface NavSection {
  id: string;
  label: string;
}

interface NavItem extends NavSection {
  isDay: boolean;
}

interface ItineraryDayView {
  day: ProposalDay;
  dayLabel: string;
  weekdayLabel: string | null;
  dateLabel: string | null;
}

interface ItineraryHighlight {
  type: ProposalServiceType;
  label: string;
}

interface ItinerarySegment {
  /** Vacío si el día no tiene "Ubicación" cargada — el template omite el
   *  encabezado del destino en ese caso, nunca inventa un nombre. */
  location: string;
  dateRangeLabel: string | null;
  days: ItineraryDayView[];
  /** Noches del segmento = cantidad de días asignados a este destino — no es
   *  un dato nuevo, es el tamaño real de `days` (mismo criterio que el resto
   *  del componente: nada se inventa, solo se deriva de lo que ya existe). */
  nights: number;
  /** Primera imagen de día disponible dentro del segmento — no hay un campo
   *  de "foto del destino" separado, así que se reutiliza la del primer día
   *  con imagen en vez de pedir un campo nuevo en el admin. */
  thumbnailUrl: string | null;
  /** Hasta 3 servicios reales del segmento (nunca inventados) para la
   *  columna "Experiencias destacadas" — no existe un campo de tags/
   *  highlights en el modelo, así que se derivan de los servicios ya
   *  cargados en cada día. Vacío si el segmento no tiene servicios. */
  highlights: ItineraryHighlight[];
}

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** "2 de octubre de 2026" — mismo estilo que el resto del componente
 *  (ver acceptedAt en el template, formateado igual con DatePipe). */
function formatFullDate(date: Date): string {
  return `${date.getDate()} de ${MESES[date.getMonth()]} de ${date.getFullYear()}`;
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
  imports: [DatePipe, CurrencyPipe, NgTemplateOutlet, RouterLink, RevealOnScrollDirective, Footer],
  templateUrl: './private-proposal.html',
  styleUrl: './private-proposal.css'
})
export class PrivateProposal implements OnDestroy {
  private readonly publicProposal = inject(PublicProposalService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly elementRef: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly document = inject(DOCUMENT);

  readonly token = input.required<string>();
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;
  /** Consejos de un destino agrupados por tipo, en un orden fijo; los que no
   *  tienen tipo van al final como "Consejos generales". Solo salen los tipos
   *  que tienen al menos un consejo. */
  tipTypeGroups(group: ProposalTravelTipGroup): { key: string; label: string; tips: ProposalTravelTip[] }[] {
    const order = ['restaurants', 'transport', 'weather', 'customs', 'safety', 'payments', 'other'];
    const buckets = new Map<string, ProposalTravelTip[]>();
    for (const tip of group.tips) {
      const key = tip.category && order.includes(tip.category) ? tip.category : 'general';
      buckets.set(key, [...(buckets.get(key) ?? []), tip]);
    }
    return [...order, 'general']
      .filter((key) => buckets.has(key))
      .map((key) => ({
        key,
        label: key === 'general' ? 'Consejos generales' : this.tipCategoryLabel[key],
        tips: buckets.get(key)!
      }));
  }

  readonly tipCategoryLabel: Record<string, string> = {
    restaurants: 'Restaurantes',
    transport: 'Transporte',
    weather: 'Clima y equipaje',
    customs: 'Costumbres y propinas',
    safety: 'Seguridad y salud',
    payments: 'Pagos y compras',
    other: 'Otro'
  };
  readonly detailRows = serviceDetailRows;

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
  /** 'network_error' es local a este componente (no viene de
   *  ProposalAccessResult) — separa un fallo de red/RPC real de "not_found",
   *  que implica que la propuesta no existe. Antes ambos casos caían en el
   *  mismo mensaje ("no disponible"), lo cual es engañoso para un simple
   *  problema de conexión. */
  readonly accessError = signal<ProposalAccessResult | 'network_error' | null>(null);
  private readonly gateCodeInput = viewChild<ElementRef<HTMLInputElement>>('gateCodeInput');

  readonly acceptedByName = signal('');
  readonly termsChecked = signal(false);
  readonly accepting = signal(false);
  readonly acceptError = signal<string | null>(null);
  readonly justAccepted = signal(false);

  /** "Sí, por favor" por servicio — { [serviceId]: true|false }, tal cual
   *  viene del servidor (ver set_proposal_service_choice, migración 0043). */
  readonly serviceChoices = signal<Record<string, boolean>>({});
  readonly choiceBusyId = signal<string | null>(null);

  /** Comentarios / pedidos de cambio por servicio, tal cual están guardados. */
  readonly serviceComments = signal<Record<string, string>>({});
  /** Un solo comentario abierto a la vez — el servicio cuyo cuadro de texto se está editando. */
  readonly commentOpenId = signal<string | null>(null);
  readonly commentDraft = signal('');
  readonly commentSavingId = signal<string | null>(null);
  readonly feedbackSending = signal(false);
  readonly feedbackSent = signal(false);
  readonly feedbackError = signal<string | null>(null);
  readonly commentError = signal<string | null>(null);
  readonly choiceError = signal<string | null>(null);
  /** Las elecciones solo se editan mientras la propuesta siga abierta — una
   *  vez aceptada quedan fijas (el RPC también lo rechaza). */
  readonly canChooseServices = computed(() => {
    const status = this.data()?.status;
    return status === 'published' || status === 'viewed';
  });

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

  readonly safeWelcomeBody = computed<SafeHtml | null>(() => {
    const body = this.data()?.content.welcome.body;
    return body && body.replace(/<[^>]*>/g, '').trim() ? this.sanitizer.bypassSecurityTrustHtml(sanitizeRichHtml(body)) : null;
  });

  /** Detalle de costos por día + mezcla por tipo (ver buildPricingBreakdown). */
  readonly pricingBreakdown = computed(() => {
    const d = this.data();
    return d ? buildPricingBreakdown(d.content) : null;
  });

  /** Inversión por viajero — solo con más de un viajero (con uno sería el total repetido). */
  readonly pricePerTraveler = computed<number | null>(() => {
    const d = this.data();
    return d?.travelersCount && d.travelersCount > 1 ? d.pricingTotal / d.travelersCount : null;
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

  /** Días/noches como dos valores separados (en vez del string combinado de
   *  durationLabel) para el bloque de estadísticas tipo "10 días / 8 noches"
   *  del resumen — mismo cálculo de nightsBetween, solo partido en dos. */
  readonly durationDaysLabel = computed<string | null>(() => {
    const d = this.data();
    if (!d?.startDate || !d?.endDate) {
      return null;
    }
    const nights = nightsBetween(d.startDate, d.endDate);
    return nights === null ? null : `${nights + 1} días`;
  });

  readonly durationNightsLabel = computed<string | null>(() => {
    const d = this.data();
    if (!d?.startDate || !d?.endDate) {
      return null;
    }
    const nights = nightsBetween(d.startDate, d.endDate);
    return nights === null ? null : `${nights} noche${nights === 1 ? '' : 's'}`;
  });

  /** "Abril 2026" — sub-línea del bloque de temporada, derivada de
   *  start_date igual que seasonLabel. */
  readonly monthYearLabel = computed<string | null>(() => {
    const start = this.data()?.startDate;
    if (!start) {
      return null;
    }
    const date = parseIsoDate(start);
    return `${capitalize(MESES[date.getMonth()])} ${date.getFullYear()}`;
  });

  /** Ninguno de estos 4 datos se inventa si falta — el resumen del viaje
   *  simplemente omite la fila correspondiente (ver sección 8 de la spec:
   *  "No inventar noches si no puede calcularse con certeza"). */
  readonly hasTripSummary = computed<boolean>(
    () => !!(this.destinationBadge() || this.datesLabel() || this.durationLabel() || this.travelersLabel())
  );

  readonly hasTravelTips = computed<boolean>(() => (this.data()?.content.travelTips.length ?? 0) > 0);

  /** Tabla "Overview" que se muestra antes del itinerario día a día — agrupa
   *  días consecutivos que comparten la misma "Ubicación" (sin inventar
   *  agrupaciones nuevas ni tocar el modelo/editor). Las fechas por día solo
   *  se calculan si la propuesta tiene start_date; si no, se muestra el
   *  itinerario sin fechas en vez de inventarlas. */
  readonly itineraryOverview = computed<ItinerarySegment[]>(() => {
    const d = this.data();
    if (!d || d.content.days.length === 0) {
      return [];
    }
    const startDate = d.startDate ? parseIsoDate(d.startDate) : null;
    const days = [...d.content.days].sort((a, b) => a.dayNumber - b.dayNumber);

    const segments: ItinerarySegment[] = [];
    for (const day of days) {
      const location = day.location?.trim() ?? '';
      const dayDate = startDate ? addDays(startDate, day.dayNumber - 1) : null;
      const view: ItineraryDayView = {
        day,
        dayLabel: `Día ${day.dayNumber}`,
        weekdayLabel: dayDate ? capitalize(DIAS_SEMANA[dayDate.getDay()]) : null,
        dateLabel: dayDate ? formatFullDate(dayDate) : null
      };
      const last = segments[segments.length - 1];
      if (last && location && last.location.toLowerCase() === location.toLowerCase()) {
        last.days.push(view);
      } else {
        segments.push({ location, dateRangeLabel: null, days: [view], nights: 0, thumbnailUrl: null, highlights: [] });
      }
    }

    for (const segment of segments) {
      const first = segment.days[0].day;
      const last = segment.days[segment.days.length - 1].day;
      segment.nights = segment.days.length;
      segment.thumbnailUrl = segment.days.find((view) => view.day.imagePath)?.day.imagePath ?? null;
      segment.highlights = segment.days
        .flatMap((view) => view.day.services)
        .slice(0, 3)
        .map((service) => ({ type: service.type, label: service.title || this.serviceTypeLabel[service.type] }));

      if (!startDate) {
        continue;
      }
      const firstDate = addDays(startDate, first.dayNumber - 1);
      const lastDate = addDays(startDate, last.dayNumber - 1);
      segment.dateRangeLabel =
        first.dayNumber === last.dayNumber ? formatFullDate(firstDate) : formatDateRange(toIsoDate(firstDate), toIsoDate(lastDate));
    }

    return segments;
  });

  /** Texto de la banda de cada día — "Viernes, 2 de octubre de 2026 – Madrid".
   *  Se arma solo con lo que existe: sin start_date no hay fecha y sin
   *  "Ubicación" no hay destino; si no hay ninguno de los dos, no hay banda. */
  dayBandLabel(day: ProposalDay): string {
    const view = this.itineraryOverview()
      .flatMap((segment) => segment.days)
      .find((v) => v.day.id === day.id);
    const when = [view?.weekdayLabel, view?.dateLabel].filter(Boolean).join(', ');
    const where = day.location?.trim() ?? '';
    return [when, where].filter(Boolean).join(' – ');
  }

  /** Colapsado por defecto — la tabla resumen del itinerario es lo primero
   *  que se ve, y "Ver itinerario completo" revela las tarjetas día a día
   *  que ya existían (mismo contenido, ahora detrás de un toggle en vez de
   *  siempre visible). */
  readonly itineraryExpanded = signal(false);
  toggleItineraryExpanded(): void {
    const expanded = !this.itineraryExpanded();
    this.itineraryExpanded.set(expanded);
    this.daysMotion?.revert();
    this.daysMotion = undefined;
    if (this.reducedMotion.reduced()) {
      return;
    }
    // Las tarjetas de día se montan en el ciclo de CD siguiente — igual que
    // en loadContent, hay que esperar a que existan antes de animarlas.
    setTimeout(() => {
      if (expanded) {
        this.daysMotion = animateItineraryDays(this.elementRef.nativeElement);
      }
      // Expandir/colapsar cambia la altura de la página: sin esto los
      // ScrollTriggers de las secciones de abajo quedan con posiciones viejas.
      refreshScrollTriggers();
    }, 30);
  }

  /** Igual que itineraryExpanded pero para el desglose de precios — el total
   *  y el resumen siempre están a la vista, las líneas de precio quedan
   *  detrás de "Ver detalle de costos". */
  readonly pricingExpanded = signal(false);
  togglePricingExpanded(): void {
    this.pricingExpanded.update((v) => !v);
  }

  /** Estación del año a partir del mes de start_date — derivada, no
   *  inventada, y asume hemisferio norte (el negocio opera desde Honduras).
   *  null si no hay start_date, nunca se muestra un valor por defecto. */
  readonly seasonLabel = computed<string | null>(() => {
    const start = this.data()?.startDate;
    if (!start) {
      return null;
    }
    const month = parseIsoDate(start).getMonth();
    if (month === 11 || month <= 1) return 'Invierno';
    if (month <= 4) return 'Primavera';
    if (month <= 7) return 'Verano';
    return 'Otoño';
  });

  /** Nav interna — solo lista secciones que realmente tienen contenido, para
   *  no ofrecer un link muerto a "Servicios" en una propuesta sin días. */
  readonly navSections = computed<NavSection[]>(() => {
    const d = this.data();
    if (!d) {
      return [];
    }
    const sections: NavSection[] = [];
    if (this.safeWelcomeBody()) {
      sections.push({ id: 'bienvenida', label: 'Bienvenida' });
    }
    if (d.content.intro.headline || d.content.intro.body) {
      sections.push({ id: 'resumen', label: 'Resumen' });
    }
    if (d.content.days.length > 0) {
      sections.push({ id: 'itinerario', label: 'Itinerario' });
    }
    if (d.content.travelTips.length > 0) {
      sections.push({ id: 'consejos', label: 'Consejos' });
    }
    if (d.content.pricing.lines.length > 0 || d.content.pricing.feesLines.length > 0) {
      sections.push({ id: 'inversion', label: 'Inversión' });
    }
    if (d.content.terms.body) {
      sections.push({ id: 'terminos', label: 'Términos' });
    }
    sections.push({ id: 'aceptar', label: d.status === 'accepted' ? 'Propuesta aceptada' : 'Aceptar propuesta' });
    return sections;
  });

  /** Ítems del menú lateral: las secciones, con un ítem por día justo debajo
   *  de "Itinerario" (fecha solo si la propuesta tiene start_date — nunca se
   *  inventa). Clic en un día expande el itinerario completo si hace falta. */
  readonly navItems = computed<NavItem[]>(() => {
    const d = this.data();
    if (!d) {
      return [];
    }
    const startDate = d.startDate ? parseIsoDate(d.startDate) : null;
    const days = [...d.content.days].sort((a, b) => a.dayNumber - b.dayNumber);
    const items: NavItem[] = [];
    for (const section of this.navSections()) {
      items.push({ ...section, isDay: false });
      if (section.id !== 'itinerario') {
        continue;
      }
      for (const day of days) {
        const date = startDate ? addDays(startDate, day.dayNumber - 1) : null;
        const number = day.dayNumber < 10 ? `0${day.dayNumber}` : `${day.dayNumber}`;
        items.push({
          id: `dia-${day.id}`,
          label: date ? `Día ${number} – ${date.getDate()} ${shortMonth(date)} ${date.getFullYear()}` : `Día ${number}`,
          isDay: true
        });
      }
    }
    return items;
  });

  private introMotion?: gsap.Context;
  private scrollMotion?: gsap.Context;
  private daysMotion?: gsap.Context;

  constructor() {
    this.document.documentElement.classList.add('no-scrollbar');
    this.title.setTitle('Propuesta privada | The Travel Edit');
    this.meta.updateTag({ name: 'robots', content: 'noindex, nofollow' });

    // El token viene del router (withComponentInputBinding) y todavía no
    // tiene valor en el primer tick del constructor — leerlo fuera de un
    // effect() dispara NG0950, mismo motivo que en article-detail.ts.
    effect(() => {
      void this.init(this.token());
    });

    // Foco inicial en el código de acceso (sección 19 de la spec) — a
    // propósito NO se usa el atributo HTML `autofocus`: en mobile el hero
    // se reordena visualmente antes que el panel (order:-1, ver CSS), y el
    // scroll-into-view nativo de autofocus saltaba la imagen entera para
    // llevar al input a la vista. focus({ preventScroll: true }) da el
    // mismo foco sin ese salto, en cualquier viewport.
    effect(() => {
      const input = this.gateCodeInput();
      if (this.phase() === 'gate' && input) {
        input.nativeElement.focus({ preventScroll: true });
      }
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

    // Pasada la fecha de expiración el enlace sigue abriendo, pero el acceso venció: se avisa que
    // pida a su asesora que lo renueve (la sesión guardada ya no sirve y no se pide ningún código).
    if (gate.status === 'expired') {
      this.clearStoredSession(token);
      this.accessError.set('expired');
      this.phase.set('gate');
      return;
    }

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
      this.serviceChoices.set(data.serviceChoices);
      this.serviceComments.set(data.serviceComments);
      this.sessionToken = sessionToken;
      this.phase.set('content');
      // Un tick después de montar el contenido, no en el mismo — así el CSS
      // de transición (opacity/transform) tiene un estado inicial real desde
      // el que animar en vez de arrancar ya en el estado final.
      setTimeout(() => this.contentRevealed.set(true), 20);
      // Más tarde que contentRevealed: necesita que las secciones @if ya
      // estén en el DOM (Angular las monta en el ciclo de CD posterior al
      // phase.set('content') de arriba) antes de poder observarlas.
      setTimeout(() => this.setupScrollSpy(), 50);
      setTimeout(() => this.startMotion(), 60);
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
        // Salida animada del panel antes del swap a 'content' — "no navegar
        // con salto visual brusco" (spec del access gate, sección 10). Se
        // omite en reduced-motion: ahí la espera artificial no aporta nada.
        if (!this.reducedMotion.reduced()) {
          await playGateExit(this.elementRef.nativeElement);
        }
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
      this.accessError.set('network_error');
      this.phase.set('gate');
    } finally {
      this.verifying.set(false);
    }
  }

  async toggleServiceChoice(serviceId: string): Promise<void> {
    const session = this.sessionToken;
    if (!session || !this.canChooseServices() || this.choiceBusyId()) {
      return;
    }
    const previous = this.serviceChoices();
    const next = !previous[serviceId];
    // Optimista: el botón responde al instante y vuelve atrás si el RPC falla.
    this.serviceChoices.set({ ...previous, [serviceId]: next });
    this.choiceBusyId.set(serviceId);
    this.choiceError.set(null);
    try {
      await this.publicProposal.setServiceChoice(this.token(), session, serviceId, next);
    } catch (error) {
      console.error('No se pudo guardar la elección del servicio.', error);
      this.serviceChoices.set(previous);
      this.choiceError.set('No pudimos guardar tu elección. Inténtalo de nuevo en unos segundos.');
    } finally {
      this.choiceBusyId.set(null);
    }
  }

  openComment(serviceId: string): void {
    this.commentError.set(null);
    this.commentDraft.set(this.serviceComments()[serviceId] ?? '');
    this.commentOpenId.set(serviceId);
  }

  closeComment(): void {
    this.commentOpenId.set(null);
    this.commentError.set(null);
  }

  onCommentInput(event: Event): void {
    this.commentDraft.set((event.target as HTMLTextAreaElement).value);
  }

  async saveComment(serviceId: string): Promise<void> {
    const session = this.sessionToken;
    if (!session || !this.canChooseServices() || this.commentSavingId()) {
      return;
    }
    const text = this.commentDraft().trim();
    this.commentSavingId.set(serviceId);
    this.commentError.set(null);
    try {
      await this.publicProposal.setServiceComment(this.token(), session, serviceId, text);
      this.serviceComments.update((current) => {
        const next = { ...current };
        if (text) {
          next[serviceId] = text;
        } else {
          delete next[serviceId];
        }
        return next;
      });
      this.commentOpenId.set(null);
      this.feedbackSent.set(false);
    } catch (error) {
      console.error('No se pudo guardar el comentario.', error);
      this.commentError.set('No pudimos enviar tu comentario. Inténtalo de nuevo en unos segundos.');
    } finally {
      this.commentSavingId.set(null);
    }
  }

  commentCount(): number {
    return Object.keys(this.serviceComments()).length;
  }

  hasComments(): boolean {
    return Object.keys(this.serviceComments()).length > 0;
  }

  /** Un solo correo al equipo con todos los comentarios que dejo el cliente. */
  async sendFeedback(): Promise<void> {
    const session = this.sessionToken;
    if (!session || this.feedbackSending() || !this.hasComments()) {
      return;
    }
    this.feedbackSending.set(true);
    this.feedbackError.set(null);
    const ok = await this.publicProposal.notifyActivity(this.token(), session, 'feedback');
    this.feedbackSending.set(false);
    if (ok) {
      this.feedbackSent.set(true);
    } else {
      this.feedbackError.set('No pudimos enviar tus comentarios. Inténtalo de nuevo en unos segundos.');
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
      void this.publicProposal.notifyActivity(token, session, 'accepted');
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
    this.setActiveSection(id);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // Es un día y el itinerario completo sigue colapsado: se expande primero
    // y se espera a que las tarjetas existan antes de desplazarse.
    if (id.startsWith('dia-') && !this.itineraryExpanded()) {
      this.toggleItineraryExpanded();
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        this.setupScrollSpy();
      }, 120);
    }
  }

  private scrollObserver: IntersectionObserver | null = null;

  private setActiveSection(id: string): void {
    this.activeSectionId.set(id);
    moveSidebarIndicator(this.elementRef.nativeElement, id, !this.reducedMotion.reduced());
  }

  /** Entrada de la portada + animaciones ligadas al scroll. Una sola vez por
   *  montaje: loadContent() se vuelve a llamar tras aceptar la propuesta y la
   *  portada no debe reanimarse en ese momento. */
  private startMotion(): void {
    if (this.introMotion) {
      return;
    }
    const root = this.elementRef.nativeElement;
    if (this.reducedMotion.reduced()) {
      return;
    }
    this.introMotion = playProposalIntro(root);
    this.scrollMotion = setupProposalScroll(root);
    moveSidebarIndicator(root, this.activeSectionId(), false);
  }

  /** Resalta en el menú "Ir a sección" cuál sección se está viendo mientras se
   *  hace scroll — banda de detección centrada en el tercio superior de la
   *  pantalla (no el viewport completo) para que el cambio de sección activa
   *  se sienta natural y no cambie recién cuando la sección está por salir. */
  private setupScrollSpy(): void {
    this.scrollObserver?.disconnect();
    const elements = this.navItems()
      .map((item) => this.elementRef.nativeElement.querySelector<HTMLElement>(`#${item.id}`))
      .filter((el): el is HTMLElement => !!el);
    if (elements.length === 0) {
      return;
    }
    this.scrollObserver = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible.length > 0) {
          this.setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 }
    );
    for (const el of elements) {
      this.scrollObserver.observe(el);
    }
  }

  ngOnDestroy(): void {
    this.document.documentElement.classList.remove('no-scrollbar');
    this.scrollObserver?.disconnect();
    this.introMotion?.revert();
    this.scrollMotion?.revert();
    this.daysMotion?.revert();
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
