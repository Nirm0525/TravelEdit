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
  currency: string;
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

function mapService(service: ExtractedService, newId: () => string): MappedService {
  const fields = incomingServiceFields(service);

  const details: Record<string, string> = {};
  for (const [key, value] of Object.entries(fields.details)) {
    if (typeof value === 'string' && value.trim() !== '') {
      details[key] = value;
    }
  }
  // La ubicación del PDF se aprovecha donde la ficha del tipo tiene un campo equivalente.
  if (service.location) {
    if (service.type === 'hotel') {
      details.address ??= service.location;
    } else if (service.type === 'activity') {
      details.meetingPoint ??= service.location;
    }
  }

  const mapped: MappedService = {
    id: newId(),
    type: service.type,
    title: service.name,
    description: service.description ?? '',
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

/** Notas generales → un grupo de Travel Tips (sin duplicados). Sin notas, ningún grupo. */
function mapTravelTips(notes: string[], newId: () => string): MappedTravelTipGroup[] {
  const seen = new Set<string>();
  const tips: MappedTravelTip[] = [];
  for (const raw of notes) {
    const body = raw.trim();
    const key = body.toLowerCase();
    if (body === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    const weather = WEATHER_TIP.test(body);
    tips.push({ id: newId(), title: weather ? TIP_TITLE.weather : TIP_TITLE.general, body, category: weather ? 'weather' : '' });
  }
  return tips.length > 0 ? [{ id: newId(), destination: GENERAL_TIPS_DESTINATION, tips }] : [];
}

export function mapExtractionToProposal(input: Extraction, newId: () => string = () => crypto.randomUUID()): MappedProposal {
  // Los servicios generales salen de los días ANTES de mapear (así los índices de servicio de los precios siguen alineados).
  // No van a ninguna otra parte: ProposalContent no tiene dónde ponerlos (ver la cabecera).
  const data: Extraction = { ...input, days: input.days.map((day) => ({ ...day, services: day.services.filter((s) => !isGeneralService(s)) })) };

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

    const services = day.services.map((service) => mapService(service, newId));
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
    currency: data.pricing?.currency ?? DEFAULT_CURRENCY,
    content: {
      cover: { title: data.trip.title ?? '', subtitle: '', imagePath: null },
      welcome: { body: '' },
      intro: { headline: '', body: '' },
      days,
      pricing: { lines, feesLines },
      travelTips: mapTravelTips(data.notes, newId),
      terms: { title: DEFAULT_TERMS_TITLE, body: '' }
    }
  };
}
