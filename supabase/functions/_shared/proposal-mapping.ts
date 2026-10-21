// Mapeo de lo extraído de un PDF (modo "new") al contenido de una propuesta nueva.
//
// El destino es el modelo real de proposals.content (ver
// projects/admin/src/app/core/models/proposal.model.ts): días con servicios, ficha por tipo en
// service.details y pricing.lines / feesLines con quantity × unitPrice.
//
// Reglas:
//  - Ningún texto del PDF va a campos de HTML enriquecido. En la propuesta pública solo se
//    renderizan como HTML welcome.body, intro.body y terms.body: aquí quedan vacíos (los términos
//    conservan su título de partida). Descripciones, notas y títulos son texto plano.
//  - Las notas generales del viaje (clima, equipaje, qué documentos llevar…) van a Travel Tips, el único lugar de
//    ProposalContent pensado para consejos: un grupo "General" con un consejo por nota, en texto plano.
//  - Los servicios GENERALES del viaje (la asistencia al viajero, cuya vigencia cubre todo el viaje) no se ponen en
//    ningún día ni en Travel Tips (una asistencia contratada no es un consejo): ProposalContent no tiene un lugar
//    para servicios generales, así que NO se incorporan al borrador. La vista previa los muestra aparte y lo avisa.
//    Lo específico de un servicio ya viaja con él (activity.included → details.included, "No incluye" → notes,
//    y description). Las inclusiones y exclusiones generales del viaje NO se aplican: ProposalContent no tiene un
//    campo para ellas (los términos son HTML y ningún texto del PDF va a HTML); solo se ven en la vista previa.
//  - Lo que falte queda vacío para completarlo en el constructor; nada se inventa.
//  - Precios: pricing.lines es la fuente principal; el price de un servicio solo crea una línea si el
//    PDF no trae pricing.lines (incomingPriceLines), y la línea de un servicio lleva su serviceId.
import type { Extraction, ExtractedService } from './proposal-extraction.ts';
import { isGeneralService } from './proposal-postprocess.ts';
import { incomingPriceLines, incomingServiceFields } from './proposal-diff.ts';
import { resolvePriceLine, travelersTotal } from './proposal-pricing.ts';
import { MODALITY_LABEL } from './proposal-extraction.ts';
import { normalizeName } from './proposal-text.ts';
import { sanitizeExtractionForKind, type TravelKind } from './travel-kind.ts';

export type MappedServiceType = 'flight' | 'hotel' | 'transfer' | 'activity' | 'other';

export interface MappedService {
  id: string;
  type: MappedServiceType;
  title: string;
  description: string;
  notes: string;
  time: string;
  imagePath: null;
  details: Record<string, string>;
  /** Solo 'meal' (comida) o 'train' (tren); ausente en el resto. */
  subtype?: 'meal' | 'train';
}

export interface MappedDay {
  id: string;
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  imagePath: null;
  services: MappedService[];
}

export interface MappedPricingLine {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  serviceId?: string;
}

export interface MappedTravelTip {
  id: string;
  title: string;
  body: string;
  /** Una de PROPOSAL_TIP_CATEGORIES del admin; '' = «Consejos generales». */
  category: string;
}

export interface MappedTravelTipGroup {
  id: string;
  destination: string;
  tips: MappedTravelTip[];
}

export interface MappedContent {
  cover: { title: string; subtitle: string; imagePath: null };
  welcome: { body: string };
  intro: { headline: string; body: string };
  days: MappedDay[];
  pricing: { lines: MappedPricingLine[]; feesLines: MappedPricingLine[] };
  travelTips: MappedTravelTipGroup[];
  terms: { title: string; body: string };
}

export interface MappedProposal {
  clientName: string;
  clientEmail: string | null;
  clientPhone: string | null;
  destinationText: string | null;
  startDate: string | null;
  endDate: string | null;
  travelersCount: number | null;
  /** null en un itinerario: no tiene moneda (la base conserva su valor por defecto). */
  currency: string | null;
  content: MappedContent;
}

/** Mismo título de partida que usan las propuestas nuevas del constructor (DEFAULT_TERMS_TITLE). */
export const DEFAULT_TERMS_TITLE = 'Términos y condiciones';
const DEFAULT_CURRENCY = 'USD';
/** Nombre del grupo de consejos que recibe las notas generales del PDF. */
export const GENERAL_TIPS_DESTINATION = 'General';
const WEATHER_TIP = /clima|temperatura|equipaje|abrigo|ropa|lluvia|calzado|maleta/i;
// El constructor muestra «Sin título» si el consejo no lo tiene, así que cada uno lleva uno corto y genérico.
const TIP_TITLE = { weather: 'Clima y equipaje', general: 'Recomendación' } as const;
// Mismo formato que la restricción proposals_client_email_format (0045).
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/i;

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-11-19" → "19 nov 2026" (determinista, sin depender del locale del servidor). */
export function formatShortDate(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? '');
  const month = m ? MONTHS[Number(m[2]) - 1] : undefined;
  return m && month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}

/** "02:48" + "2026-11-19" → "02:48 · 19 nov 2026"; solo lo que exista. */
function timeAndDate(time: string | null | undefined, date: string | null | undefined): string | null {
  const parts = [time?.trim() || null, formatShortDate(date)].filter((x): x is string => !!x);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** Suma un párrafo a la descripción sin repetir lo que ya dice. */
function appendParagraph(base: string, extra: string): string {
  if (base === '') {
    return extra;
  }
  return normalizeName(base).includes(normalizeName(extra)) ? base : `${base}\n\n${extra}`;
}

function mapService(service: ExtractedService, dayDate: string | null, newId: () => string): MappedService {
  const fields = incomingServiceFields(service);

  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields.details)) {
    if (typeof value === 'string' && value.trim() !== '') {
      details[key] = value;
    }
  }
  let description = service.description?.trim() ?? '';

  // La ubicación del PDF se aprovecha donde la ficha del tipo tiene un campo equivalente.
  if (service.location) {
    if (service.type === 'hotel') {
      details.address ??= service.location;
    } else if (service.type === 'activity') {
      details.meetingPoint ??= service.location;
    } else if (service.type === 'flight' || service.type === 'transfer') {
      // Sin campo visible: va a la descripción solo si aporta algo que la ficha y la descripción no dicen ya.
      const known = normalizeName(
        [description, details.origin, details.destination, details.pickupLocation, details.dropoffLocation].filter(Boolean).join(' | ')
      );
      const loc = normalizeName(service.location);
      if (loc !== '' && !known.includes(loc)) {
        description = appendParagraph(description, `Ubicación: ${service.location.trim()}`);
      }
    }
  }

  // Vuelo: la llegada lleva su fecha cuando ocurre otro día de la salida (o no se sabe el día de salida).
  if (service.type === 'flight' && service.flight?.arrival_date) {
    const { arrival_time: time, arrival_date: date } = service.flight;
    if ((service.date ?? dayDate) !== date) {
      const value = timeAndDate(time, date);
      if (value) {
        details.arrivalTime = value;
      }
    }
  }

  // Hotel: la hora de check-in/out lleva su fecha para que el rango se vea en la ficha (checkInDate/checkOutDate se conservan).
  if (service.type === 'hotel' && service.hotel) {
    const checkIn = timeAndDate(service.hotel.check_in_time, service.hotel.check_in_date);
    const checkOut = timeAndDate(service.hotel.check_out_time, service.hotel.check_out_date);
    if (checkIn) {
      details.checkIn = checkIn;
    }
    if (checkOut) {
      details.checkOut = checkOut;
    }
  }

  // La modalidad solo tiene campo visible en los traslados (transferType); en el resto se dice en la descripción.
  if (service.modality && service.type !== 'transfer') {
    const label = MODALITY_LABEL[service.modality];
    if (!normalizeName(description).includes(normalizeName(label))) {
      description = appendParagraph(description, `Modalidad: ${label}`);
    }
  }

  const mapped: MappedService = {
    id: newId(),
    type: service.type,
    title: service.name,
    description,
    notes: service.notes ?? '',
    time: fields.time ?? '',
    imagePath: null,
    details
  };
  if (service.subtype) {
    mapped.subtype = service.subtype;
  }
  return mapped;
}

// ---------------------------------------------------------------- Travel Tips

// El orden importa: gana la primera regla que coincide. Solo categorías de PROPOSAL_TIP_CATEGORIES.
const TIP_RULES: { category: string; title: string; pattern: RegExp }[] = [
  { category: 'other', title: 'Documentación', pattern: /pasaporte|visa\b|visado|documentaci[oó]n|documentos?\b|identificaci[oó]n|migraci[oó]n|aduana/i },
  { category: 'weather', title: TIP_TITLE.weather, pattern: WEATHER_TIP },
  { category: 'safety', title: 'Seguridad y salud', pattern: /seguridad|robo|hurto|cuide|precauci[oó]n|salud|vacuna|medicin|mareo|altura|protector solar|agua potable/i },
  { category: 'customs', title: 'Costumbres', pattern: /propina|costumbre|etiqueta|vestimenta|saludo|respeto/i },
  { category: 'payments', title: 'Pagos y compras', pattern: /efectivo|moneda|cambio\s+de|tarjetas?\b|cajero|pagos?\b|compras/i },
  { category: 'transport', title: 'Transporte', pattern: /aeropuerto|traslado|transporte|taxi|metro\b|autob[uú]s|\bbus\b|\btren\b|vuelo|conexi[oó]n|check-?in/i }
];

function classifyTip(body: string): { category: string; title: string } {
  const rule = TIP_RULES.find((r) => r.pattern.test(body));
  return rule ? { category: rule.category, title: rule.title } : { category: '', title: TIP_TITLE.general };
}

/** La ciudad que la nota nombra con claridad (una sola de las conocidas); si menciona varias o ninguna, null. */
function cityOfNote(body: string, cities: string[]): string | null {
  const text = ` ${normalizeName(body)} `;
  const hits = cities.filter((city) => {
    const key = normalizeName(city);
    return key.length >= 3 && text.includes(` ${key} `);
  });
  return hits.length === 1 ? hits[0] : null;
}

/**
 * Notas generales → Travel Tips (sin duplicados). Una nota que nombra una sola ciudad conocida (de los días o de los
 * destinos del viaje) va al grupo de esa ciudad; el resto, al grupo "General". Sin notas, ningún grupo.
 */
function mapTravelTips(notes: string[], cities: string[], newId: () => string): MappedTravelTipGroup[] {
  const seen = new Set<string>();
  const groups = new Map<string, MappedTravelTip[]>();
  for (const raw of notes) {
    const body = raw.trim();
    const key = body.toLowerCase();
    // Una nota que tras la limpieza de datos sensibles quedó solo en signos (".") no es un consejo.
    if (!/[\p{L}\d]/u.test(body) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const { category, title } = classifyTip(body);
    const destination = cityOfNote(body, cities) ?? GENERAL_TIPS_DESTINATION;
    const tips = groups.get(destination) ?? [];
    tips.push({ id: newId(), title, body, category });
    groups.set(destination, tips);
  }
  // "General" primero; las ciudades, en el orden en que aparece su primera nota.
  const ordered = [...groups.entries()].sort(([a], [b]) => Number(b === GENERAL_TIPS_DESTINATION) - Number(a === GENERAL_TIPS_DESTINATION));
  return ordered.map(([destination, tips]) => ({ id: newId(), destination, tips }));
}

/**
 * @param kind 'proposal' (por defecto) mapea todo; 'itinerary' descarta lo comercial/contractual (ver travel-kind.ts) aunque
 *   la extracción lo traiga: sin precios, sin moneda y sin términos de partida.
 */
export function mapExtractionToProposal(
  input: Extraction,
  newId: () => string = () => crypto.randomUUID(),
  kind: TravelKind = 'proposal'
): MappedProposal {
  const clean = sanitizeExtractionForKind(input, kind);
  // Los servicios generales salen de los días ANTES de mapear (así los índices de servicio de los precios siguen alineados).
  // No van a ninguna otra parte: ProposalContent no tiene dónde ponerlos (ver la cabecera).
  const data: Extraction = { ...clean, days: clean.days.map((day) => ({ ...day, services: day.services.filter((s) => !isGeneralService(s)) })) };

  // --- días y servicios ---
  const usedNumbers = new Set<number>();
  const serviceIds: string[][] = [];
  const days: MappedDay[] = data.days.map((day, index) => {
    // Número de día único (la unión de días repetidos ya se hizo en el posprocesado).
    let dayNumber = day.number >= 1 ? day.number : index + 1;
    while (usedNumbers.has(dayNumber)) {
      dayNumber += 1;
    }
    usedNumbers.add(dayNumber);

    const services = day.services.map((service) => mapService(service, day.date, newId));
    serviceIds.push(services.map((s) => s.id));
    return {
      id: newId(),
      dayNumber,
      title: day.title ?? day.base_city ?? '',
      location: day.base_city ?? '',
      description: day.summary ?? '',
      imagePath: null,
      services
    };
  });

  // Ciudades conocidas (de los días y del viaje) para ubicar las notas por destino.
  const tipCities = [...new Set([...data.days.map((d) => d.base_city ?? ''), ...data.trip.destinations].map((c) => c.trim()).filter(Boolean))];

  // --- precios ---
  const travelers = travelersTotal(data.travelers.adults, data.travelers.children);
  const lines: MappedPricingLine[] = [];
  const feesLines: MappedPricingLine[] = [];
  for (const { line, serviceRef } of incomingPriceLines(data)) {
    const { quantity, unitPrice } = resolvePriceLine(line, travelers);
    const mapped: MappedPricingLine = {
      id: newId(),
      label: line.detail ? `${line.concept} — ${line.detail}` : line.concept,
      quantity,
      unitPrice
    };
    if (line.kind === 'fee') {
      feesLines.push(mapped);
    } else {
      const serviceId = serviceRef ? serviceIds[serviceRef.day_index]?.[serviceRef.service_index] : undefined;
      if (serviceId) {
        mapped.serviceId = serviceId;
      }
      lines.push(mapped);
    }
  }

  const email = data.client.email?.trim() ?? '';
  return {
    clientName: data.client.name?.trim() ?? '',
    clientEmail: EMAIL_FORMAT.test(email) ? email : null,
    clientPhone: data.client.phone?.trim() || null,
    destinationText: data.trip.destinations.length > 0 ? data.trip.destinations.join(', ') : null,
    startDate: data.trip.start_date,
    endDate: data.trip.end_date,
    travelersCount: travelers && travelers > 0 ? travelers : null,
    currency: kind === 'itinerary' ? null : (data.pricing?.currency ?? DEFAULT_CURRENCY),
    content: {
      cover: { title: data.trip.title ?? '', subtitle: '', imagePath: null },
      welcome: { body: '' },
      intro: { headline: '', body: '' },
      days,
      pricing: { lines, feesLines },
      travelTips: mapTravelTips(data.notes, tipCities, newId),
      terms: kind === 'itinerary' ? { title: '', body: '' } : { title: DEFAULT_TERMS_TITLE, body: '' }
    }
  };
}
