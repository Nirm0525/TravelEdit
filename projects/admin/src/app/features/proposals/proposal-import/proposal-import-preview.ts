import { StoredExtraction } from '../../../core/models/proposal-extraction.types';
import { PROPOSAL_SERVICE_TYPE_LABEL, ProposalServiceType } from '../../../core/models/proposal-enums';

/** Modelo de vista previa: lo que se mostrará de lo extraído, ya formateado. Funciones puras (probadas en el .spec). */

export interface PreviewService {
  typeLabel: string;
  name: string;
  time: string | null;
  modality: string | null;
}

export interface PreviewDay {
  key: string;
  number: number;
  title: string;
  city: string | null;
  date: string | null;
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

export function buildPreview(data: StoredExtraction): ImportPreview {
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
    title: day.title ?? day.base_city ?? '',
    city: day.base_city,
    date: formatDate(day.date),
    services: day.services.map((s) => ({
      typeLabel: s.subtype === 'meal' ? 'Comida' : s.subtype === 'train' ? 'Tren' : (PROPOSAL_SERVICE_TYPE_LABEL[s.type as ProposalServiceType] ?? s.type),
      name: s.name,
      time: s.type === 'flight' ? (s.flight?.departure_time ?? s.time) : s.time,
      modality: s.modality ? MODALITY_LABEL[s.modality] : null
    }))
  }));

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
    serviceCount: days.reduce((n, d) => n + d.services.length, 0),
    pricing: hasPricing ? { currency: data.pricing?.currency ?? null, total: data.pricing?.total ?? null, lines } : null,
    warnings: data.warnings.map((w) => w.message),
    missing: data.missing,
    inclusions: data.inclusions,
    exclusions: data.exclusions,
    notes: data.notes
  };
}
