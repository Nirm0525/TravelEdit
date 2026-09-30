import { Component, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { Proposal, ProposalDay } from '../../../../core/models/proposal.model';
import { PROPOSAL_SERVICE_TYPE_LABEL, ProposalServiceType } from '../../../../core/models/proposal-enums';

// --- Fechas/agrupación por destino: espejo deliberado de las funciones
// equivalentes en src/app/features/private-proposal/private-proposal.ts —
// admin y sitio público son apps Angular separadas que a propósito no
// comparten código (mismo criterio que proposal-content.model.ts, "mirror"
// del modelo del admin), así que en vez de un import cross-proyecto frágil
// esto se mantiene como un espejo de la misma lógica. Cualquier cambio de
// comportamiento en un lado debe replicarse manualmente en el otro.
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

const DIAS_SEMANA = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function parseIsoDate(value: string): Date {
  const parts = value.split('-').map(Number);
  return new Date(parts[0]!, parts[1]! - 1, parts[2]!);
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

function formatFullDate(date: Date): string {
  return `${date.getDate()} de ${MESES[date.getMonth()]} de ${date.getFullYear()}`;
}

function shortMonth(date: Date): string {
  return MESES[date.getMonth()]!.slice(0, 3);
}

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

function nightsBetween(startIso: string, endIso: string): number | null {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  const diffDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return diffDays > 0 ? diffDays : null;
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
  location: string;
  dateRangeLabel: string | null;
  days: ItineraryDayView[];
  nights: number;
  thumbnailPath: string | null;
  highlights: ItineraryHighlight[];
}

/**
 * Vista previa interna: lee la propuesta con el cliente autenticado normal
 * (RLS de staff, ver supabase/migrations/0029_proposals.sql) — nunca pasa
 * por el gate público (get_proposal_gate/verify_proposal_access), nunca
 * pide código de acceso. No es un renderer compartido con el sitio público
 * (apps separadas, ver nota en public-proposal.ts) — refleja la misma
 * jerarquía editorial (hero/resumen/itinerario/consejos/inversión/términos/
 * cierre) dentro de los tokens de diseño del admin, con la misma lógica de
 * agrupación/derivación que la propuesta pública real.
 */
@Component({
  selector: 'app-preview-step',
  imports: [DatePipe, CurrencyPipe],
  templateUrl: './preview-step.html',
  styleUrl: './preview-step.css'
})
export class PreviewStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);

  readonly proposalId = input.required<string>();
  /** Se monta también como columna persistente (no solo página completa) —
   *  el shell la incrementa cada vez que cualquier paso guarda algo, para
   *  que la vista previa refleje ediciones hechas en otros tabs sin que
   *  esta instancia tenga que compartir estado con ellos. */
  readonly refreshTick = input<number>(0);
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;

  readonly proposal = signal<Proposal | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  /** Solo UI local — nunca escriben en la propuesta ni llaman al backend. */
  readonly itineraryExpanded = signal(false);
  readonly pricingExpanded = signal(false);

  // Ver ngOnInit — proposal() todavía es null en el constructor.
  ngOnInit(): void {
    void this.load();
  }

  constructor() {
    let firstRun = true;
    effect(() => {
      this.refreshTick();
      if (firstRun) {
        // ngOnInit ya dispara la primera carga — evita duplicarla.
        firstRun = false;
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.proposal.set(await this.proposalsService.getById(this.proposalId()));
    } catch (error) {
      console.error('No se pudo cargar la vista previa.', error);
      this.loadError.set('No se pudo cargar la vista previa. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  imageUrl(path: string | null): string | null {
    return this.proposalImages.publicUrl(path);
  }

  toggleItineraryExpanded(): void {
    this.itineraryExpanded.update((v) => !v);
  }

  togglePricingExpanded(): void {
    this.pricingExpanded.update((v) => !v);
  }

  readonly travelersLabel = computed<string | null>(() => {
    const count = this.proposal()?.travelersCount;
    return count && count > 0 ? `${count} viajero${count === 1 ? '' : 's'}` : null;
  });

  readonly durationDaysLabel = computed<string | null>(() => {
    const p = this.proposal();
    if (!p?.startDate || !p?.endDate) {
      return null;
    }
    const nights = nightsBetween(p.startDate, p.endDate);
    return nights === null ? null : `${nights + 1} días`;
  });

  readonly durationNightsLabel = computed<string | null>(() => {
    const p = this.proposal();
    if (!p?.startDate || !p?.endDate) {
      return null;
    }
    const nights = nightsBetween(p.startDate, p.endDate);
    return nights === null ? null : `${nights} noche${nights === 1 ? '' : 's'}`;
  });

  readonly seasonLabel = computed<string | null>(() => {
    const start = this.proposal()?.startDate;
    if (!start) {
      return null;
    }
    const month = parseIsoDate(start).getMonth();
    if (month === 11 || month <= 1) return 'Invierno';
    if (month <= 4) return 'Primavera';
    if (month <= 7) return 'Verano';
    return 'Otoño';
  });

  readonly monthYearLabel = computed<string | null>(() => {
    const start = this.proposal()?.startDate;
    if (!start) {
      return null;
    }
    const date = parseIsoDate(start);
    return `${capitalize(MESES[date.getMonth()]!)} ${date.getFullYear()}`;
  });

  readonly hasSummaryStats = computed<boolean>(
    () => !!(this.durationDaysLabel() || this.travelersLabel() || this.seasonLabel())
  );

  /** Misma agrupación/derivación que itineraryOverview en private-proposal.ts
   *  — días consecutivos con la misma "Ubicación", noches = cantidad de días
   *  del segmento, highlights derivados de los servicios reales (nunca
   *  inventados), miniatura = primer día del segmento con imagen. */
  readonly itineraryOverview = computed<ItinerarySegment[]>(() => {
    const p = this.proposal();
    if (!p || p.content.days.length === 0) {
      return [];
    }
    const startDate = p.startDate ? parseIsoDate(p.startDate) : null;
    const days = [...p.content.days].sort((a, b) => a.dayNumber - b.dayNumber);

    const segments: ItinerarySegment[] = [];
    for (const day of days) {
      const location = day.location?.trim() ?? '';
      const dayDate = startDate ? addDays(startDate, day.dayNumber - 1) : null;
      const view: ItineraryDayView = {
        day,
        dayLabel: `Día ${day.dayNumber}`,
        weekdayLabel: dayDate ? capitalize(DIAS_SEMANA[dayDate.getDay()]!) : null,
        dateLabel: dayDate ? formatFullDate(dayDate) : null
      };
      const last = segments[segments.length - 1];
      if (last && location && last.location.toLowerCase() === location.toLowerCase()) {
        last.days.push(view);
      } else {
        segments.push({ location, dateRangeLabel: null, days: [view], nights: 0, thumbnailPath: null, highlights: [] });
      }
    }

    for (const segment of segments) {
      const first = segment.days[0]!.day;
      const last = segment.days[segment.days.length - 1]!.day;
      segment.nights = segment.days.length;
      segment.thumbnailPath = segment.days.find((view) => view.day.imagePath)?.day.imagePath ?? null;
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
}
