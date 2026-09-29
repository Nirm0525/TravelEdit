import { Database } from './database.types';
import { ProposalServiceType, ProposalStatus } from './proposal-enums';

type ProposalRow = Database['public']['Tables']['proposals']['Row'];

export interface ProposalCover {
  title: string;
  subtitle: string;
  imagePath: string | null;
}

export interface ProposalIntro {
  headline: string;
  body: string;
}

export interface ProposalServiceItem {
  /** UUID estable — nunca el índice del array. Ver ADR en proposals.ts. */
  id: string;
  type: ProposalServiceType;
  title: string;
  description: string;
  notes: string;
  /** Hora opcional en texto libre (ej. "07:45") — se usa en la tabla Overview
   *  del itinerario público. Vacío = no se muestra hora, no se inventa una. */
  time: string;
}

export interface ProposalDay {
  /** UUID estable — nunca el índice del array. */
  id: string;
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  imagePath: string | null;
  services: ProposalServiceItem[];
}

// Fuente única de verdad del pricing: content.pricing.lines/feesLines. Las
// columnas pricing_subtotal/fees/total de `proposals` son una caché de
// solo-lectura recalculada siempre server-side (ver
// supabase/migrations/0029_proposals.sql, recompute_proposal_pricing()) —
// nunca se envían como autoritativas desde Angular.
//
// ProposalFeeLine usa el mismo shape {quantity, unitPrice} que
// ProposalPricingLine, NO {label, amount}: el trigger real de Supabase
// calcula feesLines igual que lines (quantity * unitPrice). Un objeto
// {amount: N} sin quantity/unitPrice haría que pricing_fees computara 0
// siempre, silenciosamente. En la UI cada línea de fee se edita como una
// línea de precio más (quantity casi siempre 1).
export interface ProposalPricingLine {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
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

// Estaba en el brief original (cover/introduction/overview/days/services/
// pricing/travelTips/terms, ver comentario en 0029_proposals.sql) pero nunca
// se implementó — se cayó en algún punto del scoping del MVP. Texto plano,
// no rich text (mismo criterio que ProposalDay.description): son tips
// cortos y puntuales, no necesitan formato.
export interface ProposalTravelTip {
  id: string;
  title: string;
  body: string;
}

export interface ProposalTravelTipGroup {
  id: string;
  destination: string;
  tips: ProposalTravelTip[];
}

export interface ProposalContent {
  cover: ProposalCover;
  intro: ProposalIntro;
  days: ProposalDay[];
  pricing: ProposalPricing;
  travelTips: ProposalTravelTipGroup[];
  terms: ProposalTerms;
}

export interface Proposal {
  id: string;
  publicToken: string;
  leadId: string | null;
  status: ProposalStatus;
  clientName: string;
  destinationText: string | null;
  startDate: string | null;
  endDate: string | null;
  travelersCount: number | null;
  advisorId: string | null;
  currency: string;
  accessRequired: boolean;
  content: ProposalContent;
  /** Espejo de solo lectura de content.cover.title (columna GENERATED en Supabase). */
  title: string | null;
  /** Espejo de solo lectura de content.cover.imagePath (columna GENERATED en Supabase). */
  coverImagePath: string | null;
  pricingSubtotal: number;
  pricingFees: number;
  pricingTotal: number;
  termsAccepted: boolean;
  acceptedAt: string | null;
  acceptedByName: string | null;
  publishedAt: string | null;
  viewedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createEmptyProposalContent(): ProposalContent {
  return {
    cover: { title: '', subtitle: '', imagePath: null },
    intro: { headline: '', body: '' },
    days: [],
    pricing: { lines: [], feesLines: [] },
    travelTips: [],
    terms: { title: 'Términos y condiciones', body: '' }
  };
}

export function createTravelTipGroup(): ProposalTravelTipGroup {
  return { id: crypto.randomUUID(), destination: '', tips: [] };
}

export function createTravelTip(): ProposalTravelTip {
  return { id: crypto.randomUUID(), title: '', body: '' };
}

export function createProposalDay(dayNumber: number): ProposalDay {
  return {
    id: crypto.randomUUID(),
    dayNumber,
    title: '',
    location: '',
    description: '',
    imagePath: null,
    services: []
  };
}

export function createProposalService(type: ProposalServiceType): ProposalServiceItem {
  return {
    id: crypto.randomUUID(),
    type,
    title: '',
    description: '',
    notes: '',
    time: ''
  };
}

export function createPricingLine(): ProposalPricingLine {
  return { id: crypto.randomUUID(), label: '', quantity: 1, unitPrice: 0 };
}

export function createFeeLine(): ProposalFeeLine {
  return { id: crypto.randomUUID(), label: '', quantity: 1, unitPrice: 0 };
}

/** El contenido siempre lo escribe este mismo builder — un valor inesperado
 *  (jsonb vacío `{}` en una propuesta recién creada) se resuelve al shape
 *  vacío en vez de fallar, mismo criterio que toLeadTripDetails(). */
export function toProposalContent(value: unknown): ProposalContent {
  const empty = createEmptyProposalContent();
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const raw = value as Partial<ProposalContent>;
  return {
    cover: { ...empty.cover, ...raw.cover },
    intro: { ...empty.intro, ...raw.intro },
    days: Array.isArray(raw.days) ? raw.days : [],
    pricing: {
      lines: Array.isArray(raw.pricing?.lines) ? raw.pricing.lines : [],
      feesLines: Array.isArray(raw.pricing?.feesLines) ? raw.pricing.feesLines : []
    },
    // Array.isArray(...) ? ... : [] — cualquier propuesta creada antes de
    // este campo existir tiene contenido guardado sin `travelTips`; sin este
    // fallback, abrirla rompería el builder en vez de mostrar la sección
    // vacía como corresponde.
    travelTips: Array.isArray(raw.travelTips) ? raw.travelTips : [],
    terms: { ...empty.terms, ...raw.terms }
  };
}

export function toProposal(row: ProposalRow): Proposal {
  return {
    id: row.id,
    publicToken: row.public_token,
    leadId: row.lead_id,
    status: row.status,
    clientName: row.client_name,
    destinationText: row.destination_text,
    startDate: row.start_date,
    endDate: row.end_date,
    travelersCount: row.travelers_count,
    advisorId: row.advisor_id,
    currency: row.currency,
    accessRequired: row.access_required,
    content: toProposalContent(row.content),
    title: row.title,
    coverImagePath: row.cover_image_path,
    pricingSubtotal: Number(row.pricing_subtotal),
    pricingFees: Number(row.pricing_fees),
    pricingTotal: Number(row.pricing_total),
    termsAccepted: row.terms_accepted,
    acceptedAt: row.accepted_at,
    acceptedByName: row.accepted_by_name,
    publishedAt: row.published_at,
    viewedAt: row.viewed_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
