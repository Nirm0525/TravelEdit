// Posprocesado determinista de lo que devuelve el modelo, antes de revisar coherencia y de
// calcular el diff. Orden:
//  1) limpieza de datos sensibles (proposal-sanitize.ts);
//  2) unión de días repetidos (el mismo día en varias secciones del PDF);
//  3) red de seguridad de precios: se descartan de `pricing` las líneas que son claramente
//     coberturas de seguro, políticas de equipaje o penalidades (el prompt ya lo prohíbe);
//  4) sin precios → `pricing` en null y se anota en `missing`.
// Además: clasificación de servicios (una experiencia con comida no es "comida"; la asistencia al viajero
// lleva un nombre descriptivo y nunca un precio) y `missing` solo con lo que de verdad falta (un dato
// personal que se descarta por privacidad no es un dato faltante).
// Cada intervención deja un warning (sin valores sensibles).
import type { Extraction, ExtractedDay, ExtractedService, ExtractionWarning } from './proposal-extraction.ts';
import { PRIVACY_NOTICE, scrubSensitive } from './proposal-sanitize.ts';
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

// ---------------------------------------------------------------- clasificación de servicios

/** Experiencias: aunque incluyan comida o bebida, son una actividad, no una comida suelta. */
const EXPERIENCE =
  /\b(?:show|espect[aá]culo|tango|folcl|flamenco|concierto|degustaci[oó]n|cata\b|tours?\b|excursi[oó]n|clase\b|taller|experiencia)/i;

/** Asistencia al viajero / seguro de viaje (no hay un tipo propio en ProposalContent: va como `other`). */
// OJO: la vista previa del admin (proposal-import-preview.ts) usa la misma expresión para ubicar estos servicios
// fuera de los días; un test compara ambas para que no se desfasen.
export const TRAVEL_ASSISTANCE = /asistencia\s+(?:al\s+viajero|m[eé]dica|en\s+viaje)|seguro\s+de\s+viaje|travel\s+(?:insurance|assistance)/i;
export const ASSISTANCE_NAME_PREFIX = 'Asistencia al viajero';

export function isTravelAssistance(s: ExtractedService): boolean {
  return s.type === 'other' && TRAVEL_ASSISTANCE.test(`${s.name} ${s.description ?? ''}`);
}

/**
 * Servicio general del viaje: no ocurre en un día concreto. Hoy, la asistencia al viajero o el seguro de viaje (su
 * vigencia cubre todo el viaje). Se decide por el NOMBRE, que el posprocesado ya dejó descriptivo, para que el
 * servidor y la vista previa coincidan. ProposalContent no tiene un lugar para servicios generales: ver el mapeo.
 */
export function isGeneralService(s: ExtractedService): boolean {
  return s.type === 'other' && TRAVEL_ASSISTANCE.test(s.name);
}

/**
 * - 'meal' que en realidad es una experiencia (cena show, degustación, tour…) → actividad normal (sin subtype).
 * - Asistencia al viajero: nombre descriptivo ("Asistencia al viajero · <plan>") y sin `price`: los montos de
 *   cobertura no son precios del viaje. Devuelve los nombres de los servicios a los que se les quitó el precio.
 */
function normalizeServices(days: ExtractedDay[]): { days: ExtractedDay[]; priceDropped: string[] } {
  const priceDropped: string[] = [];
  const out = days.map((day) => ({
    ...day,
    services: day.services.map((service) => {
      let next = service;
      if (next.type === 'activity' && next.subtype === 'meal' && EXPERIENCE.test(`${next.name} ${next.description ?? ''}`)) {
        next = { ...next, subtype: null };
      }
      if (isTravelAssistance(next)) {
        if (!TRAVEL_ASSISTANCE.test(next.name)) {
          next = { ...next, name: `${ASSISTANCE_NAME_PREFIX} · ${next.name}` };
        }
        if (next.price) {
          priceDropped.push(next.name);
          next = { ...next, price: null };
        }
      }
      return next;
    })
  }));
  return { days: out, priceDropped };
}

// ---------------------------------------------------------------- precios

/** Montos que NO son precios del viaje: coberturas de seguro, equipaje, penalidades. */
const NOT_A_TRIP_PRICE =
  /cobertura|asistencia\s+m[eé]dica|gastos\s+m[eé]dicos|repatriaci[oó]n|penalidad|penalizaci[oó]n|cargo\s+por\s+(?:cambio|cancelaci[oó]n)|pol[ií]tica\s+de\s+equipaje|equipaje\s+(?:extraviado|demorado|perdido|de\s+bodega|de\s+mano|adicional)|l[ií]mite\s+de|deducible|preexistencia|medicamentos|odontol[oó]gic|interrupci[oó]n\s+de\s+viaje|cancelaci[oó]n\s+de\s+viaje|asistencia\s+(?:al\s+viajero|en\s+viaje)/i;

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

// ---------------------------------------------------------------- missing vs privacidad

/**
 * Entradas de `missing` sobre datos personales que NO se importan a propósito (pasaporte, nacimiento, boleto,
 * localizador, asiento, tarjeta). Que el documento los traiga y se descarten no es un dato que falte.
 */
const PRIVACY_TOPIC =
  /nacimiento|pasaporte|localizador|asientos?\b|tarjeta|(?:n[úu]meros?|c[óo]digos?)\s+de\s+(?:boletos?|tickets?|reservas?|documentos?)|boletos?\s+electr[óo]nicos?|e-?tickets?|documentos?\s+de\s+identidad|datos\s+(?:personales|sensibles)/i;
const AGES = /edad(?:es)?/i;

/** Quita de `missing` lo que se descarta por privacidad; devuelve cuántas entradas quitó. */
function dropPrivacyMissing(data: Extraction): { data: Extraction; dropped: number } {
  // Las edades de los adultos nunca se importan; las de los niños sí (children_ages), y si faltan, falta de verdad.
  const hasChildren = (data.travelers.children ?? 0) > 0;
  const missing = data.missing.filter((m) => !(PRIVACY_TOPIC.test(m) || (!hasChildren && AGES.test(m))));
  const dropped = data.missing.length - missing.length;
  return dropped === 0 ? { data, dropped } : { data: { ...data, missing }, dropped };
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

  const normalized = normalizeServices(data.days);
  data = { ...data, days: normalized.days };

  const { data: withoutCoverages, dropped: droppedLines } = dropNonTripPriceLines(data);
  const dropped = [...droppedLines, ...normalized.priceDropped];
  if (dropped.length > 0) {
    warnings.push({
      code: 'pricing_lines_dropped',
      message: `Se descartaron ${dropped.length} línea${dropped.length === 1 ? '' : 's'} de precio que parecen coberturas de seguro, equipaje o penalidades, no precios del viaje: ${dropped.slice(0, 6).join('; ')}.`
    });
  }
  data = withoutCoverages;

  // `missing` solo con lo que de verdad falta; si el modelo anotó un dato personal que se descarta, se avisa en genérico.
  const privacy = dropPrivacyMissing(data);
  data = privacy.data;
  if (privacy.dropped > 0 && !warnings.some((w) => w.code === 'sensitive_data_removed')) {
    warnings.push({ code: 'sensitive_data_removed', message: PRIVACY_NOTICE });
  }

  if (data.pricing && data.pricing.lines.length === 0 && data.pricing.total == null) {
    data = { ...data, pricing: null };
  }
  if (!data.pricing && !data.missing.some((m) => /precio|pricing|tarifa|cotizaci/i.test(m))) {
    data = { ...data, missing: [...data.missing, PRICING_MISSING] };
  }

  return { extraction: data, warnings };
}
