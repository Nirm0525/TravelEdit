import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { PROPOSAL_SERVICE_TYPE_LABEL, ProposalServiceType, TravelKind } from '../../../core/models/proposal-enums';

/** Modelo de vista previa: lo que se mostrará de lo extraído, ya formateado. Funciones puras (probadas en el .spec). */

export interface PreviewFact {
  label: string;
  value: string;
}

export interface PreviewService {
  typeLabel: string;
  name: string;
  time: string | null;
  modality: string | null;
  /** Descripción del servicio (recortada solo si es muy larga), si el PDF la trae. */
  description: string | null;
  /** Datos útiles para comparar con el PDF: ruta, vuelo, llegada, hotel y noches, duración, qué incluye… */
  facts: PreviewFact[];
}

export interface PreviewDay {
  key: string;
  number: number;
  title: string;
  city: string | null;
  date: string | null;
  /** Texto descriptivo del día o destino (day.summary), si el PDF lo trae. */
  summary: string | null;
  services: PreviewService[];
}

export interface PreviewPriceLine {
  label: string;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  kind: 'service' | 'fee';
  perPerson: boolean;
}

export interface ImportPreview {
  /** Servicios que valen para todo el viaje (p. ej. la asistencia al viajero): no pertenecen a ningún día. */
  generalServices: PreviewService[];
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  travelers: string | null;
  dates: string | null;
  destinations: string | null;
  days: PreviewDay[];
  serviceCount: number;
  /** null = el PDF no trae precios. */
  pricing: { currency: string | null; total: number | null; lines: PreviewPriceLine[] } | null;
  warnings: string[];
  missing: string[];
  inclusions: string[];
  exclusions: string[];
  notes: string[];
}

const MODALITY_LABEL = { private: 'Privado', shared: 'Compartido' } as const;

/** Topes de recorte: lo bastante altos para revisar el contenido útil, sin convertir la vista en una pared de texto. */
const SUMMARY_MAX = 900;
const DESCRIPTION_MAX = 900;
const FACT_MAX = 300;
const FACT_LONG_MAX = 600;

// ---------------------------------------------------------------- protección extra de datos sensibles

/**
 * La limpieza real ocurre en el servidor (proposal-sanitize.ts) antes de guardar lo extraído. Esto es una segunda
 * barrera, por si una fila antigua o un caso no cubierto trajera un dato sensible: lo que se muestra nunca lleva
 * boletos, pasaportes o documentos, fechas de nacimiento con etiqueta, localizadores, asientos ni tarjetas
 * enmascaradas. Mismas reglas que el servidor, en versión reducida.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // boleto electrónico (13 dígitos)
  /(?<!\d)\d{3}[\s-]?\d{10}(?!\d)/gu,
  // código de pasaporte suelto: 1–2 letras mayúsculas + 6–8 dígitos
  /(?<![\p{L}\d])[A-Z]{1,2}\d{6,8}(?![\p{L}\d])/gu,
  // pasaporte / documento con etiqueta y un valor con dígitos
  /(?<![\p{L}\d])(?:pasaporte|passport|dni|c[ée]dula|documento(?:\s+de\s+identidad)?|rut|curp)(?![\p{L}])[\s:#\-–]*(?:n(?:ro|[°º]|o)?\.?\s*)?(?=[\p{L}\d.\-]*\d)[\p{L}\d.\-]{5,15}(?![\p{L}\d])/giu,
  // fecha de nacimiento con etiqueta
  /(?<![\p{L}\d])(?:fecha\s+de\s+nacimiento|nacimiento|date\s+of\s+birth|birth\s*date|dob|born)(?![\p{L}])[\s:#\-–]*(?:\d{1,2}[/\-.]\d{1,2}[/\-.]\d{2,4}|\d{4}[/\-.]\d{1,2}[/\-.]\d{1,2}|\d{1,2}\s+(?:de\s+)?\p{L}{3,10}\.?\s+(?:de\s+)?\d{2,4})/giu,
  // localizador / código de reserva con etiqueta
  /(?<![\p{L}\d])(?:localizador|c[óo]digo\s+de\s+reserva|n[úu]mero\s+de\s+reserva|booking\s+(?:ref(?:erence)?|code|number)|confirmation\s+(?:code|number)|pnr|record\s+locator)(?![\p{L}])[\s:#\-–]*(?=[\p{L}\d\-]*\d)[\p{L}\d\-]{5,14}(?![\p{L}\d])/giu,
  // asiento con etiqueta (12A, 12A/12B)
  /(?<![\p{L}\d])(?:asientos?|seats?|plaza)(?![\p{L}])[\s:#\-–]*\d{1,2}[A-K](?:\s*(?:[,/y&]|and)\s*\d{1,2}[A-K])*(?![\p{L}\d])/giu,
  // tarjeta enmascarada
  /(?:[*xX•]{4}[\s-]?){1,3}\d{4}/gu
];

export function redactSensitive(text: string): string {
  let out = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    out = out.replace(pattern, '');
  }
  return out === text ? text : out.replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').trim();
}

/** Texto seguro para mostrar: sin datos sensibles, sin espacios de más y recortado. */
function safe(text: string | null | undefined, max = 200): string | null {
  const clean = redactSensitive((text ?? '').trim());
  if (clean === '') {
    return null;
  }
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

/** Misma regla que supabase/functions/_shared/proposal-pricing.ts (la que usa la creación real). */
export function resolveLine(
  line: { amount: number | null; quantity: number | null; unit_price: number | null; per_person: boolean },
  travelers: number | null
): { quantity: number; unitPrice: number } {
  if (line.quantity != null && line.unit_price != null) {
    return { quantity: line.quantity, unitPrice: line.unit_price };
  }
  const base = line.amount ?? line.unit_price;
  if (base == null) {
    return { quantity: 1, unitPrice: 0 };
  }
  if (line.per_person && travelers && travelers > 0) {
    return { quantity: travelers, unitPrice: base };
  }
  return { quantity: 1, unitPrice: base };
}

export function formatDate(iso: string | null | undefined): string | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return null;
  }
  const parts = iso.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0] ?? 0, (parts[1] ?? 1) - 1, parts[2] ?? 1));
  return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatMoney(value: number, currency: string | null): string {
  try {
    return new Intl.NumberFormat('es-HN', currency ? { style: 'currency', currency } : { maximumFractionDigits: 2 }).format(value);
  } catch {
    return `${value.toLocaleString('es-HN')} ${currency ?? ''}`.trim();
  }
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

// Misma expresión que TRAVEL_ASSISTANCE en supabase/functions/_shared/proposal-postprocess.ts (un test las compara).
const TRAVEL_ASSISTANCE = /asistencia\s+(?:al\s+viajero|m[eé]dica|en\s+viaje)|seguro\s+de\s+viaje|travel\s+(?:insurance|assistance)/i;

/** Servicio general del viaje (no ocurre en un día concreto): hoy, la asistencia al viajero o el seguro de viaje. */
export function isGeneralService(s: { type: string; name: string }): boolean {
  return s.type === 'other' && TRAVEL_ASSISTANCE.test(s.name);
}

function toPreviewService(s: StoredExtraction['days'][number]['services'][number]): PreviewService {
  return {
    typeLabel: s.subtype === 'meal' ? 'Comida' : s.subtype === 'train' ? 'Tren' : (PROPOSAL_SERVICE_TYPE_LABEL[s.type as ProposalServiceType] ?? s.type),
    name: safe(s.name, 160) ?? '(sin nombre)',
    time: s.type === 'flight' ? (s.flight?.departure_time ?? s.time) : s.time,
    modality: s.modality ? MODALITY_LABEL[s.modality] : null,
    description: safe(s.description, DESCRIPTION_MAX),
    facts: serviceFacts(s)
  };
}

function cleanList(items: string[]): string[] {
  return items.map((item) => safe(item, FACT_MAX)).filter((item): item is string => !!item);
}

function pushFact(facts: PreviewFact[], label: string, value: string | null | undefined, max = FACT_MAX): void {
  const clean = safe(value, max);
  if (clean) {
    facts.push({ label, value: clean });
  }
}

function route(from: string | null | undefined, to: string | null | undefined): string | null {
  const a = from?.trim();
  const b = to?.trim();
  if (a && b) {
    return `${a} → ${b}`;
  }
  return a || b || null;
}

function dateAndTime(date: string | null | undefined, time: string | null | undefined): string | null {
  const parts = [formatDate(date), time?.trim() || null].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function isoToUtc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1);
}

/** Noches entre dos fechas ISO (solo si ambas son válidas y la salida es posterior). */
export function nightsBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  if (!from || !to || !formatDate(from) || !formatDate(to)) {
    return null;
  }
  const nights = Math.round((isoToUtc(to) - isoToUtc(from)) / 86_400_000);
  return nights > 0 ? nights : null;
}

/** Solo campos que YA existen en lo extraído; nada se inventa y nunca se listan datos sensibles. */
export function serviceFacts(s: StoredExtraction['days'][number]['services'][number]): PreviewFact[] {
  const facts: PreviewFact[] = [];
  if (s.type === 'flight' && s.flight) {
    pushFact(facts, 'Vuelo', [s.flight.airline, s.flight.flight_number].filter(Boolean).join(' '));
    pushFact(facts, 'Ruta', route(s.flight.origin, s.flight.destination));
    pushFact(facts, 'Salida', dateAndTime(s.date, s.flight.departure_time));
    pushFact(facts, 'Llegada', dateAndTime(s.flight.arrival_date, s.flight.arrival_time));
    pushFact(facts, 'Clase', s.flight.cabin);
    pushFact(facts, 'Equipaje', s.flight.baggage);
    pushFact(facts, 'Lugar', s.location);
  } else if (s.type === 'hotel' && s.hotel) {
    pushFact(facts, 'Check-in', dateAndTime(s.hotel.check_in_date, s.hotel.check_in_time));
    pushFact(facts, 'Check-out', dateAndTime(s.hotel.check_out_date, s.hotel.check_out_time));
    const nights = nightsBetween(s.hotel.check_in_date, s.hotel.check_out_date);
    pushFact(facts, 'Noches', nights ? String(nights) : null);
    pushFact(facts, 'Habitación', s.hotel.room_type);
    pushFact(facts, 'Régimen', s.hotel.meal_plan);
    pushFact(facts, 'Categoría', s.hotel.category);
    pushFact(facts, 'Huéspedes', s.hotel.guests);
    pushFact(facts, 'Dirección', s.hotel.address ?? s.location);
  } else if (s.type === 'transfer' && s.transfer) {
    pushFact(facts, 'Ruta', route(s.transfer.from, s.transfer.to));
    pushFact(facts, 'Vehículo', s.transfer.vehicle_type);
    pushFact(facts, 'Pasajeros', s.transfer.passengers);
    pushFact(facts, 'Equipaje', s.transfer.baggage);
    pushFact(facts, 'Lugar', s.location);
  } else if (s.type === 'activity' && s.activity) {
    pushFact(facts, 'Duración', s.activity.duration);
    pushFact(facts, 'Punto de encuentro', s.activity.meeting_point ?? s.location);
    pushFact(facts, 'Participantes', s.activity.participants);
    pushFact(facts, 'Idioma', s.activity.language);
    pushFact(facts, 'Incluye', s.activity.included, FACT_LONG_MAX);
  } else if (s.location) {
    pushFact(facts, 'Lugar', s.location);
  }
  pushFact(facts, 'No incluye', s.notes, FACT_LONG_MAX);
  return facts;
}

/** Códigos de aviso que solo tienen sentido con precios. */
const PRICING_WARNING_CODES = new Set(['multiple_currencies', 'price_per_person_unknown_travelers', 'price_line_without_amount', 'price_total_mismatch', 'pricing_lines_dropped']);
const CONTRACTUAL_MISSING = /precio|pricing|price|tarifa|cotizaci|costo|moneda|currency|t[eé]rminos|condiciones|terms/i;

/**
 * Lo que un ITINERARIO puede mostrar de una extracción: solo contenido operativo. El servidor ya lo descartó antes de guardarlo
 * (import-proposal-pdf); aquí se repite como segunda barrera para que la pantalla nunca pinte precios ni condiciones.
 */
function operativeOnly(data: StoredExtraction): StoredExtraction {
  return {
    ...data,
    pricing: null,
    inclusions: [],
    exclusions: [],
    missing: data.missing.filter((m) => !CONTRACTUAL_MISSING.test(m)),
    warnings: data.warnings.filter((w) => !PRICING_WARNING_CODES.has(w.code)),
    days: data.days.map((day) => ({ ...day, services: day.services.map((service) => ({ ...service, price: null })) }))
  };
}

export function buildPreview(input: StoredExtraction, kind: TravelKind = 'proposal'): ImportPreview {
  const data = kind === 'itinerary' ? operativeOnly(input) : input;
  const adults = data.travelers.adults;
  const children = data.travelers.children;
  const total = adults == null && children == null ? null : (adults ?? 0) + (children ?? 0);

  const travelerParts: string[] = [];
  if (adults) {
    travelerParts.push(plural(adults, 'adulto', 'adultos'));
  }
  if (children) {
    const ages = data.travelers.children_ages.length > 0 ? ` (${data.travelers.children_ages.join(', ')} años)` : '';
    travelerParts.push(`${plural(children, 'niño', 'niños')}${ages}`);
  }

  const start = formatDate(data.trip.start_date);
  const end = formatDate(data.trip.end_date);

  const days: PreviewDay[] = data.days.map((day, index) => ({
    key: `${day.number}-${index}`,
    number: day.number,
    title: safe(day.title ?? day.base_city ?? '', 120) ?? '',
    city: day.base_city,
    date: formatDate(day.date),
    summary: safe(day.summary, SUMMARY_MAX),
    services: day.services.filter((s) => !isGeneralService(s)).map(toPreviewService)
  }));
  const generalServices = data.days.flatMap((day) => day.services.filter(isGeneralService)).map(toPreviewService);

  // Líneas: pricing.lines es la fuente; el price de un servicio solo cuenta si el PDF no trae pricing.lines.
  let lines: PreviewPriceLine[] = [];
  if (data.pricing && data.pricing.lines.length > 0) {
    lines = data.pricing.lines.map((l) => {
      const { quantity, unitPrice } = resolveLine(l, total);
      return {
        label: l.detail ? `${l.concept} — ${l.detail}` : l.concept,
        quantity,
        unitPrice,
        subtotal: quantity * unitPrice,
        kind: l.kind,
        perPerson: l.per_person
      };
    });
  } else {
    for (const day of data.days) {
      for (const s of day.services) {
        if (s.price) {
          const { quantity, unitPrice } = resolveLine(
            { amount: s.price.amount, quantity: null, unit_price: null, per_person: s.price.per_person },
            total
          );
          lines.push({ label: s.name, quantity, unitPrice, subtotal: quantity * unitPrice, kind: 'service', perPerson: s.price.per_person });
        }
      }
    }
  }
  const hasPricing = data.pricing != null || lines.length > 0;

  return {
    clientName: data.client.name,
    clientEmail: data.client.email,
    clientPhone: data.client.phone,
    travelers: travelerParts.length > 0 ? travelerParts.join(', ') : null,
    dates: start && end ? `${start} → ${end}` : (start ?? end),
    destinations: data.trip.destinations.length > 0 ? data.trip.destinations.join(', ') : null,
    days,
    generalServices,
    serviceCount: days.reduce((n, d) => n + d.services.length, 0),
    pricing: hasPricing ? { currency: data.pricing?.currency ?? null, total: data.pricing?.total ?? null, lines } : null,
    warnings: data.warnings.map((w) => w.message),
    missing: cleanList(data.missing),
    inclusions: cleanList(data.inclusions),
    exclusions: cleanList(data.exclusions),
    notes: cleanList(data.notes)
  };
}
