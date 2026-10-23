// Espejo de projects/admin/src/app/core/models/proposal.model.ts (solo la
// parte de `content`) — son apps separadas que deliberadamente no comparten
// código (mismo criterio que lead-trip-details.ts). El sitio público solo
// lee este contenido, nunca lo escribe, así que no duplica los factory
// helpers (createProposalDay, etc.) del lado admin.

export type ProposalServiceType = 'hotel' | 'activity' | 'transfer' | 'flight' | 'other';

export interface ProposalCover {
  title: string;
  subtitle: string;
  imagePath: string | null;
  /** Textos editables del Resumen (ver CoverStats). Ausente = todo automático. */
  stats?: CoverStats;
}

/** Los 4 datos con icono del Resumen. Cada campo vacío (o ausente) se calcula solo desde las fechas y los viajeros. */
export type CoverStatKey = 'duration' | 'travelers' | 'season' | 'custom';

export interface CoverStat {
  value?: string;
  label?: string;
}

export type CoverStats = Partial<Record<CoverStatKey, CoverStat>>;

export interface ProposalWelcome {
  body: string;
}

export interface ProposalIntro {
  headline: string;
  body: string;
}

export interface ProposalServiceItem {
  id: string;
  type: ProposalServiceType;
  title: string;
  description: string;
  notes: string;
  time: string;
  imagePath: string | null;
  details?: Record<string, string>;
}

export interface ProposalDayRecommendations {
  headline: string;
  body: string;
}

export interface ProposalDay {
  id: string;
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  imagePath: string | null;
  services: ProposalServiceItem[];
  /** Opcional: ausente en los días anteriores a este campo. */
  recommendations?: ProposalDayRecommendations;
}

/** Un texto enriquecido vacío (`<p></p>` del editor) cuenta como vacío; una imagen sola sí es contenido. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) {
    return true;
  }
  return !/<img\b/i.test(html) && !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

export function hasDayRecommendations(day: Pick<ProposalDay, 'recommendations'>): boolean {
  const r = day.recommendations;
  return !!r && (!!r.headline?.trim() || !isRichTextEmpty(r.body));
}

export interface ProposalPricingLine {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  serviceId?: string;
}

export type ProposalFeeLine = ProposalPricingLine;

export interface ProposalPricing {
  lines: ProposalPricingLine[];
  feesLines: ProposalFeeLine[];
}

export interface ProposalTerms {
  title: string;
  body: string;
}

export interface ProposalTravelTip {
  id: string;
  title: string;
  body: string;
  category?: string;
}

export interface ProposalTravelTipGroup {
  id: string;
  destination: string;
  tips: ProposalTravelTip[];
}

export interface ProposalContent {
  cover: ProposalCover;
  welcome: ProposalWelcome;
  intro: ProposalIntro;
  days: ProposalDay[];
  pricing: ProposalPricing;
  travelTips: ProposalTravelTipGroup[];
  terms: ProposalTerms;
}

function emptyContent(): ProposalContent {
  return {
    cover: { title: '', subtitle: '', imagePath: null },
    welcome: { body: '' },
    intro: { headline: '', body: '' },
    days: [],
    pricing: { lines: [], feesLines: [] },
    travelTips: [],
    terms: { title: '', body: '' }
  };
}

export function toProposalContent(value: unknown): ProposalContent {
  const empty = emptyContent();
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const raw = value as Partial<ProposalContent>;
  return {
    cover: { ...empty.cover, ...raw.cover },
    welcome: { ...empty.welcome, ...raw.welcome },
    intro: { ...empty.intro, ...raw.intro },
    days: Array.isArray(raw.days) ? raw.days : [],
    pricing: {
      lines: Array.isArray(raw.pricing?.lines) ? raw.pricing.lines : [],
      feesLines: Array.isArray(raw.pricing?.feesLines) ? raw.pricing.feesLines : []
    },
    travelTips: Array.isArray(raw.travelTips) ? raw.travelTips : [],
    terms: { ...empty.terms, ...raw.terms }
  };
}
