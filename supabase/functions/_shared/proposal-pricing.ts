// Cantidad y precio unitario de una línea extraída. Lo usan las revisiones de
// coherencia (aquí) y la Fase 3 al aplicar (misma regla, un solo lugar).
//
//  - Si vienen quantity y unit_price, se usan tal cual.
//  - Si no, se parte de `amount` (o de unit_price si amount falta):
//      · per_person con viajeros conocidos → quantity = adultos + niños.
//      · per_person sin viajeros conocidos → quantity = 1, con alerta.
//      · si no es per_person → quantity = 1.
//  - Sin ningún monto → unitPrice = 0, con alerta.
import type { ExtractedPriceLine } from './proposal-extraction.ts';

export type PricingAssumption = 'per_person_quantity' | 'unknown_travelers' | 'missing_amount' | null;

export interface ResolvedLine {
  quantity: number;
  unitPrice: number;
  assumption: PricingAssumption;
}

export function resolvePriceLine(line: ExtractedPriceLine, travelersCount: number | null): ResolvedLine {
  if (line.quantity != null && line.unit_price != null) {
    return { quantity: line.quantity, unitPrice: line.unit_price, assumption: null };
  }
  const base = line.amount ?? line.unit_price;
  if (base == null) {
    return { quantity: 1, unitPrice: 0, assumption: 'missing_amount' };
  }
  if (line.per_person) {
    if (travelersCount && travelersCount > 0) {
      return { quantity: travelersCount, unitPrice: base, assumption: 'per_person_quantity' };
    }
    return { quantity: 1, unitPrice: base, assumption: 'unknown_travelers' };
  }
  return { quantity: 1, unitPrice: base, assumption: null };
}

export function travelersTotal(adults: number | null, children: number | null): number | null {
  if (adults == null && children == null) {
    return null;
  }
  return (adults ?? 0) + (children ?? 0);
}
