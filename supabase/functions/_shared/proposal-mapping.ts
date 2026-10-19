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
//  - Inclusiones, exclusiones y notas generales NO se aplican (solo se muestran en la vista previa).
//  - Lo que falte queda vacío para completarlo en el constructor; nada se inventa.
//  - Precios: pricing.lines es la fuente principal; el price de un servicio solo crea una línea si el
//    PDF no trae pricing.lines (incomingPriceLines), y la línea de un servicio lleva su serviceId.
import type { Extraction, ExtractedService } from './proposal-extraction.ts';
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

export interface MappedContent {
  cover: { title: string; subtitle: string; imagePath: null };
  welcome: { body: string };
  intro: { headline: string; body: string };
  days: MappedDay[];
  pricing: { lines: MappedPricingLine[]; feesLines: MappedPricingLine[] };
  travelTips: never[];
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

export function mapExtractionToProposal(data: Extraction, newId: () => string = () => crypto.randomUUID()): MappedProposal {
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
      travelTips: [],
      terms: { title: DEFAULT_TERMS_TITLE, body: '' }
    }
  };
}
