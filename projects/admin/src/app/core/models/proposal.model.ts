import { Database } from './database.types';
import { ProposalServiceType, ProposalStatus, TravelKind } from './proposal-enums';
import { DEFAULT_TERMS_HTML, DEFAULT_TERMS_TITLE } from '../data/proposal-default-terms';

type ProposalRow = Database['public']['Tables']['proposals']['Row'];

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
  imagePath: string | null;
  /** Ficha del servicio según su tipo (ver core/data/proposal-service-fields.ts),
   *  por clave. Ausente en propuestas anteriores a este campo. */
  details?: Record<string, string>;
}

/** Recomendaciones opcionales del día (qué llevar, clima, puntualidad…). Rich text, igual que intro.body. */
export interface ProposalDayRecommendations {
  headline: string;
  body: string;
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
  /** Contenido ADICIONAL al resumen del día y a las descripciones de servicios. Ausente = el día no las tiene
   *  (todos los días anteriores a este campo); se guarda solo cuando hay titular o texto. */
  recommendations?: ProposalDayRecommendations;
}

/** Un texto enriquecido vacío (`<p></p>` del editor) cuenta como vacío; una imagen sola sí es contenido. */
export function isRichTextEmpty(html: string | null | undefined): boolean {
  if (!html) {
    return true;
  }
  return !/<img\b/i.test(html) && !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
}

/** Normaliza lo que escribió el asesor: sin titular ni texto no se guarda nada (undefined), nunca un objeto vacío. */
export function normalizeDayRecommendations(headline: string, body: string): ProposalDayRecommendations | undefined {
  const cleanHeadline = headline.trim();
  const cleanBody = isRichTextEmpty(body) ? '' : body;
  return cleanHeadline || cleanBody ? { headline: cleanHeadline, body: cleanBody } : undefined;
}

export function hasDayRecommendations(day: Pick<ProposalDay, 'recommendations'>): boolean {
  const r = day.recommendations;
  return !!r && (!!r.headline?.trim() || !isRichTextEmpty(r.body));
}

/** Copia del día con las recomendaciones puestas o quitadas (la clave se elimina, no queda en null). */
export function withDayRecommendations(day: ProposalDay, recommendations: ProposalDayRecommendations | undefined): ProposalDay {
  const { recommendations: _previous, ...rest } = day;
  return recommendations ? { ...rest, recommendations } : rest;
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
  /** Si existe, la línea es el precio de ese servicio del itinerario (ver el
   *  paso Precios). El trigger de totales solo lee quantity/unitPrice, así que
   *  este campo no afecta el cálculo. */
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

// Estaba en el brief original (cover/introduction/overview/days/services/
// pricing/travelTips/terms, ver comentario en 0029_proposals.sql) pero nunca
// se implementó — se cayó en algún punto del scoping del MVP. Texto plano,
// no rich text (mismo criterio que ProposalDay.description): son tips
// cortos y puntuales, no necesitan formato.
export interface ProposalTravelTip {
  id: string;
  title: string;
  body: string;
  /** Tipo de consejo (ver PROPOSAL_TIP_CATEGORIES); vacío/ausente = sin categoría. */
  category?: string;
}

export interface ProposalTravelTipGroup {
  id: string;
  destination: string;
  tips: ProposalTravelTip[];
}

/** Mensaje de bienvenida: sección propia antes del Resumen, dirigida a la
 *  persona que hizo la solicitud. Rich text, igual que intro.body. */
export interface ProposalWelcome {
  body: string;
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

export interface Proposal {
  id: string;
  /** Tipo de registro (proposals.kind): la fuente de verdad del modo del editor, por encima de la URL. */
  kind: TravelKind;
  publicToken: string;
  leadId: string | null;
  status: ProposalStatus;
  clientName: string;
  /** Correo al que se envía la propuesta; si falta, se usa el de la solicitud vinculada. */
  clientEmail: string | null;
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
  /** Servicios que el cliente marcó con "Sí, por favor" en la propuesta pública, por id de servicio. */
  serviceChoices: Record<string, boolean>;
  /** Comentarios / pedidos de cambio que el cliente dejó en cada servicio, por id de servicio. */
  serviceComments: Record<string, string>;
  /** Cuando el cliente envió sus comentarios al equipo (null = nunca). */
  feedbackSentAt: string | null;
  publishedAt: string | null;
  /** Cuándo se compartió el itinerario (0056); null siempre en propuestas. */
  sharedAt: string | null;
  viewedAt: string | null;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export function createEmptyProposalContent(): ProposalContent {
  return {
    cover: { title: '', subtitle: '', imagePath: null },
    welcome: { body: '' },
    intro: { headline: '', body: '' },
    days: [],
    pricing: { lines: [], feesLines: [] },
    travelTips: [],
    // Una propuesta NUEVA nace con los términos de partida (editables). Las
    // que ya existían se leen con el cuerpo vacío — ver toProposalContent().
    terms: { title: DEFAULT_TERMS_TITLE, body: DEFAULT_TERMS_HTML }
  };
}

/**
 * Contenido de partida de un ITINERARIO: portada, bienvenida, días/servicios y Travel Tips. Nada contractual: sin términos
 * de partida ni líneas de precio. `ProposalContent` es el tipo compartido y exige `intro`, `pricing` y `terms`, así que se
 * dejan con valores estructuralmente seguros (vacíos) que el itinerario ni muestra ni trata como contrato.
 */
export function createEmptyItineraryContent(): ProposalContent {
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

export const createEmptyContentFor = (kind: TravelKind): ProposalContent =>
  kind === 'itinerary' ? createEmptyItineraryContent() : createEmptyProposalContent();

/** Borrador del mensaje de bienvenida con el nombre de quien solicitó la
 *  propuesta. Solo afirma cosas que son ciertas de la propuesta en sí (fue
 *  hecha a medida, se eligen servicios con "Sí, por favor") — nada de
 *  disponibilidad, depósitos ni garantías, que dependen de cada agencia y
 *  que el agente puede agregar a mano o pedirle al asistente. */
export function defaultWelcomeText(clientName: string, kind: TravelKind = 'proposal'): string {
  const name = clientName.trim();
  if (kind === 'itinerary') {
    // Sin «Sí, por favor» ni aceptación: el itinerario no es una cotización.
    return [
      name ? `Hola, ${name}:` : 'Hola:',
      'Este itinerario ha sido preparado especialmente para ti y para tu viaje.',
      'Aquí encontrarás tu recorrido día a día, con los detalles de cada servicio.',
      'Tu asesora de viajes estará atenta para resolver cualquier duda.'
    ].join('\n\n');
  }
  return [
    name ? `Hola, ${name}:` : 'Hola:',
    'Esta propuesta ha sido diseñada especialmente para ti y para tu viaje.',
    'A medida que avances, elige con «Sí, por favor» los servicios que quieres incluir y, al terminar, acepta la propuesta.',
    'Tu asesora de viajes estará atenta para ajustar cualquier detalle.',
    'Tu viaje, a tu manera. Diseñado pensando en ti.'
  ].join('\n\n');
}

export function createTravelTipGroup(): ProposalTravelTipGroup {
  return { id: crypto.randomUUID(), destination: '', tips: [] };
}

export function createTravelTip(): ProposalTravelTip {
  return { id: crypto.randomUUID(), title: '', body: '', category: '' };
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
    time: '',
    imagePath: null,
    details: {}
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
export function toProposalContent(value: unknown, kind: TravelKind = 'proposal'): ProposalContent {
  const empty = createEmptyContentFor(kind);
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const raw = value as Partial<ProposalContent>;
  return {
    cover: { ...empty.cover, ...raw.cover },
    // Propuestas creadas antes de existir este campo no lo tienen guardado.
    welcome: { ...empty.welcome, ...raw.welcome },
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
    // body: '' primero: una propuesta guardada antes de existir este campo NO
    // debe mostrar de repente los términos de partida sin que el agente los
    // haya revisado.
    terms: { ...empty.terms, body: '', ...raw.terms }
  };
}

export function toProposal(row: ProposalRow): Proposal {
  const kind: TravelKind = row.kind === 'itinerary' ? 'itinerary' : 'proposal';
  return {
    id: row.id,
    kind,
    publicToken: row.public_token,
    leadId: row.lead_id,
    status: row.status,
    clientName: row.client_name,
    clientEmail: row.client_email ?? null,
    destinationText: row.destination_text,
    startDate: row.start_date,
    endDate: row.end_date,
    travelersCount: row.travelers_count,
    advisorId: row.advisor_id,
    currency: row.currency,
    accessRequired: row.access_required,
    content: toProposalContent(row.content, kind),
    title: row.title,
    coverImagePath: row.cover_image_path,
    pricingSubtotal: Number(row.pricing_subtotal),
    pricingFees: Number(row.pricing_fees),
    pricingTotal: Number(row.pricing_total),
    termsAccepted: row.terms_accepted,
    acceptedAt: row.accepted_at,
    acceptedByName: row.accepted_by_name,
    serviceChoices: Object.fromEntries(Object.entries(row.service_choices ?? {}).map(([id, flag]) => [id, flag === true])),
    serviceComments: Object.fromEntries(
      Object.entries(row.service_comments ?? {}).filter(([, text]) => typeof text === 'string' && text.trim()) as [string, string][]
    ),
    feedbackSentAt: row.feedback_sent_at ?? null,
    publishedAt: row.published_at,
    sharedAt: row.shared_at ?? null,
    viewedAt: row.viewed_at,
    expiresAt: row.expires_at,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
