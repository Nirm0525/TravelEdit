export type PricingKind = 'flight' | 'hotel' | 'transfer' | 'activity' | 'other' | 'extra';

export interface PricingRow {
  id: string;
  label: string;
  kind: PricingKind;
  quantity: number;
  unitPrice: number;
  amount: number;
}

export interface PricingGroup {
  key: string;
  title: string;
  subtitle: string;
  subtotal: number;
  rows: PricingRow[];
}

export interface PricingMixItem {
  kind: PricingKind;
  label: string;
  amount: number;
  /** Porcentaje entero del subtotal (los fees no entran). */
  percent: number;
}

export interface PricingBreakdown {
  groups: PricingGroup[];
  fees: PricingGroup | null;
  subtotal: number;
  feesTotal: number;
  total: number;
  mix: PricingMixItem[];
}

interface PricingLineLike {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  serviceId?: string;
}

interface PricingContentLike {
  days: {
    id: string;
    dayNumber: number;
    location: string;
    services: { id: string; type: string; title: string }[];
  }[];
  pricing: { lines: PricingLineLike[]; feesLines: PricingLineLike[] };
}

const TYPE_LABEL: Record<string, string> = {
  hotel: 'Hotel',
  flight: 'Vuelo',
  transfer: 'Traslado',
  activity: 'Actividad',
  other: 'Servicio'
};

const MIX_ORDER: { kind: PricingKind; label: string }[] = [
  { kind: 'hotel', label: 'Hoteles' },
  { kind: 'flight', label: 'Vuelos' },
  { kind: 'transfer', label: 'Traslados' },
  { kind: 'activity', label: 'Actividades' },
  { kind: 'other', label: 'Otros servicios' },
  { kind: 'extra', label: 'Otros conceptos' }
];

function toKind(type: string): PricingKind {
  return type === 'hotel' || type === 'flight' || type === 'transfer' || type === 'activity' ? type : 'other';
}

function toRow(line: PricingLineLike, kind: PricingKind, label: string): PricingRow {
  return {
    id: line.id,
    label,
    kind,
    quantity: line.quantity,
    unitPrice: line.unitPrice,
    amount: line.quantity * line.unitPrice
  };
}

function sum(rows: PricingRow[]): number {
  return rows.reduce((total, row) => total + row.amount, 0);
}

/**
 * Detalle de costos agrupado por día del itinerario (los servicios con precio
 * del paso Precios), más las líneas libres como "Otros conceptos" y los fees
 * aparte. Los totales salen de las mismas líneas que el trigger de Supabase
 * suma — esto solo los presenta, nunca los contradice.
 */
export function buildPricingBreakdown(content: PricingContentLike): PricingBreakdown {
  const lines = content.pricing.lines;
  const byService = new Map<string, PricingLineLike>();
  for (const line of lines) {
    if (line.serviceId) {
      byService.set(line.serviceId, line);
    }
  }

  const used = new Set<string>();
  const groups: PricingGroup[] = [];
  for (const day of [...content.days].sort((a, b) => a.dayNumber - b.dayNumber)) {
    const rows: PricingRow[] = [];
    for (const service of day.services) {
      const line = byService.get(service.id);
      if (line) {
        used.add(line.id);
        rows.push(toRow(line, toKind(service.type), service.title.trim() || TYPE_LABEL[toKind(service.type)] || 'Servicio'));
      }
    }
    if (rows.length > 0) {
      groups.push({
        key: day.id,
        title: `Día ${day.dayNumber}`,
        subtitle: day.location?.trim() ?? '',
        subtotal: sum(rows),
        rows
      });
    }
  }

  const extraRows = lines
    .filter((line) => !used.has(line.id))
    .map((line) => toRow(line, 'extra', line.label.trim() || 'Sin descripción'));
  if (extraRows.length > 0) {
    groups.push({ key: 'extra', title: 'Otros conceptos', subtitle: '', subtotal: sum(extraRows), rows: extraRows });
  }

  const feeRows = content.pricing.feesLines.map((line) => toRow(line, 'extra', line.label.trim() || 'Fee'));
  const fees: PricingGroup | null =
    feeRows.length > 0
      ? { key: 'fees', title: 'Cargos y tarifas', subtitle: '', subtotal: sum(feeRows), rows: feeRows }
      : null;

  const subtotal = groups.reduce((total, group) => total + group.subtotal, 0);
  const feesTotal = fees?.subtotal ?? 0;

  const allRows = groups.flatMap((group) => group.rows);
  const mix = MIX_ORDER.map(({ kind, label }) => {
    const amount = sum(allRows.filter((row) => row.kind === kind));
    return { kind, label, amount, percent: subtotal > 0 ? Math.round((amount / subtotal) * 100) : 0 };
  }).filter((item) => item.amount > 0);

  return { groups, fees, subtotal, feesTotal, total: subtotal + feesTotal, mix };
}
