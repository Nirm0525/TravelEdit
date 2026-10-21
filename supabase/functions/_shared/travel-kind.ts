// Tipo de registro de «Viajes» (proposals.kind) y lo que cada tipo puede importar de un PDF.
//
// El tipo de una importación NO viene del cuerpo de ninguna solicitud: se guarda en proposal_imports.kind al subir el PDF
// (la base lo valida con RLS: can_travel(kind, 'crear')) y las Edge Functions solo LEEN ese valor de la fila. Aquí vive la
// única definición de qué contenido es válido por tipo, para no repartir `if (kind === …)` por el pipeline:
//
//   proposal   → todo lo que ya extraía (precios, términos de partida, etc.).
//   itinerary  → solo contenido OPERATIVO: cliente, destino, fechas, viajeros, portada, días, servicios y Travel Tips.
//                Se DESCARTA todo lo comercial/contractual: precios (pricing y price de cada servicio), inclusiones y
//                exclusiones generales (son condiciones) y cualquier mención a precios o términos en `missing`.
//                Se hace del lado del servidor, sobre lo que devolvió el modelo: no se confía en el prompt ni en el frontend.
import type { Extraction } from './proposal-extraction.ts';

export const TRAVEL_KINDS = ['proposal', 'itinerary'] as const;
export type TravelKind = (typeof TRAVEL_KINDS)[number];

export const isTravelKind = (value: unknown): value is TravelKind => (TRAVEL_KINDS as readonly unknown[]).includes(value);

/** Entradas de `missing` que hablan de lo comercial/contractual: en un itinerario no «faltan», simplemente no aplican. */
const CONTRACTUAL_MISSING = /precio|pricing|price|tarifa|cotizaci|costo|moneda|currency|t[eé]rminos|condiciones|terms/i;

/** Códigos de aviso que solo tienen sentido con precios. */
export const PRICING_WARNING_CODES = new Set([
  'multiple_currencies',
  'price_per_person_unknown_travelers',
  'price_line_without_amount',
  'price_total_mismatch',
  'pricing_lines_dropped'
]);

/** La extracción tal como la puede conservar y aplicar cada tipo. Para una propuesta no cambia nada. */
export function sanitizeExtractionForKind(extraction: Extraction, kind: TravelKind): Extraction {
  if (kind === 'proposal') {
    return extraction;
  }
  return {
    ...extraction,
    pricing: null,
    inclusions: [],
    exclusions: [],
    missing: extraction.missing.filter((m) => !CONTRACTUAL_MISSING.test(m)),
    days: extraction.days.map((day) => ({ ...day, services: day.services.map((service) => ({ ...service, price: null })) }))
  };
}

/** Avisos aplicables a un tipo (los de precios no se muestran en un itinerario). */
export function warningsForKind<T extends { code: string }>(warnings: T[], kind: TravelKind): T[] {
  return kind === 'proposal' ? warnings : warnings.filter((w) => !PRICING_WARNING_CODES.has(w.code));
}
