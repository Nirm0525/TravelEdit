// Posprocesado determinista de lo que devuelve el modelo, antes de revisar coherencia y de
// calcular el diff. Orden:
//  1) limpieza de datos sensibles (proposal-sanitize.ts);
//  2) unión de días repetidos (el mismo día en varias secciones del PDF);
//  3) red de seguridad de precios: se descartan de `pricing` las líneas que son claramente
//     coberturas de seguro, políticas de equipaje o penalidades (el prompt ya lo prohíbe);
//  4) sin precios → `pricing` en null y se anota en `missing`.
// Cada intervención deja un warning (sin valores sensibles).
import type { Extraction, ExtractedDay, ExtractedService, ExtractionWarning } from './proposal-extraction.ts';
import { scrubSensitive } from './proposal-sanitize.ts';
import { normalizeName } from './proposal-text.ts';

// ---------------------------------------------------------------- días repetidos

function serviceKey(s: ExtractedService): string {
  return [s.type, normalizeName(s.name), s.time ?? '', s.date ?? ''].join('|');
}

function firstNonNull<T>(values: (T | null)[]): T | null {
  return values.find((v) => v != null) ?? null;
}

function mergeGroup(group: ExtractedDay[]): ExtractedDay {
  if (group.length === 1) {
    return group[0];
  }
  const seen = new Set<string>();
  const services: ExtractedService[] = [];
  for (const day of group) {
    for (const service of day.services) {
      const key = serviceKey(service);
      if (!seen.has(key)) {
        seen.add(key);
        services.push(service);
      }
    }
  }

  // base_city = ciudad donde se duerme esa noche: la del último hotel; si no hay hotel
  // con ciudad conocida, la última que haya indicado alguna de las secciones.
  let baseCity: string | null = null;
  for (const day of group) {
    if (day.base_city && day.services.some((s) => s.type === 'hotel')) {
      baseCity = day.base_city;
    }
  }
  baseCity ??= [...group].reverse().find((d) => d.base_city)?.base_city ?? null;

  const summaries = [...new Set(group.map((d) => d.summary).filter((x): x is string => !!x))];
  return {
    number: Math.min(...group.map((d) => d.number)),
    date: firstNonNull(group.map((d) => d.date)),
    base_city: baseCity,
    title: firstNonNull(group.map((d) => d.title)),
    summary: summaries.length > 0 ? summaries.join(' ') : null,
    services
  };
}

/** Une los días que comparten número o fecha. */
export function mergeDuplicateDays(days: ExtractedDay[]): { days: ExtractedDay[]; merged: number } {
  const groups: ExtractedDay[][] = [];
  for (const day of days) {
    const matching = groups.filter((g) => g.some((d) => d.number === day.number || (!!day.date && d.date === day.date)));
    if (matching.length === 0) {
      groups.push([day]);
    } else {
      // Puede unir varios grupos que antes parecían distintos.
      const [first, ...rest] = matching;
      first.push(day);
      for (const other of rest) {
        first.push(...other);
        groups.splice(groups.indexOf(other), 1);
      }
    }
  }
  const merged = days.length - groups.length;
  return { days: groups.map(mergeGroup).sort((a, b) => a.number - b.number), merged };
}

// ---------------------------------------------------------------- precios

/** Montos que NO son precios del viaje: coberturas de seguro, equipaje, penalidades. */
const NOT_A_TRIP_PRICE =
  /cobertura|asistencia\s+m[eé]dica|gastos\s+m[eé]dicos|repatriaci[oó]n|penalidad|penalizaci[oó]n|cargo\s+por\s+(?:cambio|cancelaci[oó]n)|pol[ií]tica\s+de\s+equipaje|equipaje\s+(?:extraviado|demorado|perdido|de\s+bodega|de\s+mano|adicional)/i;

function dropNonTripPriceLines(data: Extraction): { data: Extraction; dropped: string[] } {
  if (!data.pricing) {
    return { data, dropped: [] };
  }
  const dropped: string[] = [];
  const lines = data.pricing.lines.filter((line) => {
    if (NOT_A_TRIP_PRICE.test(`${line.concept} ${line.detail ?? ''}`)) {
      dropped.push(line.concept);
      return false;
    }
    return true;
  });
  return dropped.length === 0 ? { data, dropped } : { data: { ...data, pricing: { ...data.pricing, lines } }, dropped };
}

const PRICING_MISSING = 'Precios: el PDF no trae una sección explícita de precios, tarifas o cotización.';

// ---------------------------------------------------------------- orquestación

export function postProcessExtraction(input: Extraction): { extraction: Extraction; warnings: ExtractionWarning[] } {
  const warnings: ExtractionWarning[] = [];

  const scrubbed = scrubSensitive(input);
  warnings.push(...scrubbed.warnings);
  let data = scrubbed.data;

  const { days, merged } = mergeDuplicateDays(data.days);
  if (merged > 0) {
    warnings.push({
      code: 'days_merged',
      message: `Se unieron ${merged} día${merged === 1 ? '' : 's'} repetido${merged === 1 ? '' : 's'} (el mismo día aparecía en varias secciones del PDF). Revisa el orden de los servicios.`
    });
  }
  data = { ...data, days };

  const { data: withoutCoverages, dropped } = dropNonTripPriceLines(data);
  if (dropped.length > 0) {
    warnings.push({
      code: 'pricing_lines_dropped',
      message: `Se descartaron ${dropped.length} línea${dropped.length === 1 ? '' : 's'} de precio que parecen coberturas de seguro, equipaje o penalidades, no precios del viaje: ${dropped.slice(0, 6).join('; ')}.`
    });
  }
  data = withoutCoverages;

  if (data.pricing && data.pricing.lines.length === 0 && data.pricing.total == null) {
    data = { ...data, pricing: null };
  }
  if (!data.pricing && !data.missing.some((m) => /precio|pricing|tarifa|cotizaci/i.test(m))) {
    data = { ...data, missing: [...data.missing, PRICING_MISSING] };
  }

  return { extraction: data, warnings };
}
