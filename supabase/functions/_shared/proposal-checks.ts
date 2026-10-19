// Revisiones de coherencia deterministas sobre lo extraído. Nunca hacen fallar
// el proceso: devuelven avisos que se guardan en extracted.warnings.
import type { Extraction, ExtractionWarning } from './proposal-extraction.ts';
import { resolvePriceLine, travelersTotal } from './proposal-pricing.ts';
import { addDays, diffDays } from './proposal-text.ts';

const PRICE_TOLERANCE = 1; // 1 unidad de la moneda

function describeRanges(nights: string[]): string {
  const ranges: string[] = [];
  let start = nights[0];
  let prev = nights[0];
  for (const night of nights.slice(1)) {
    if (diffDays(prev, night) === 1) {
      prev = night;
      continue;
    }
    ranges.push(start === prev ? start : `${start} a ${prev}`);
    start = night;
    prev = night;
  }
  ranges.push(start === prev ? start : `${start} a ${prev}`);
  return ranges.join(', ');
}

export function runCoherenceChecks(data: Extraction): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const { start_date: start, end_date: end } = data.trip;

  // --- Precios ---
  const currencies = [...new Set([data.pricing.currency, ...data.pricing.other_currencies].filter(Boolean))];
  if (data.pricing.other_currencies.length > 0) {
    warnings.push({
      code: 'multiple_currencies',
      message: `El PDF trae más de una moneda (${currencies.join(', ')}). No se convirtió nada: revisa los montos.`
    });
  }

  const travelers = travelersTotal(data.travelers.adults, data.travelers.children);
  if (data.pricing.lines.length > 0) {
    let unknownTravelers = false;
    let missingAmount = false;
    let sum = 0;
    for (const line of data.pricing.lines) {
      const resolved = resolvePriceLine(line, travelers);
      sum += resolved.quantity * resolved.unitPrice;
      unknownTravelers ||= resolved.assumption === 'unknown_travelers';
      missingAmount ||= resolved.assumption === 'missing_amount';
    }
    if (unknownTravelers) {
      warnings.push({
        code: 'price_per_person_unknown_travelers',
        message: 'Hay líneas de precio "por persona" y el PDF no indica cuántos viajeros son: se tomaron como cantidad 1.'
      });
    }
    if (missingAmount) {
      warnings.push({ code: 'price_line_without_amount', message: 'Hay líneas de precio sin monto en el PDF.' });
    }
    if (data.pricing.total != null && Math.abs(sum - data.pricing.total) > PRICE_TOLERANCE) {
      warnings.push({
        code: 'price_total_mismatch',
        message: `La suma de las líneas de precio (${sum}) no coincide con el total del PDF (${data.pricing.total}).`
      });
    }
  }

  // --- Fechas ---
  if (start && end && end < start) {
    warnings.push({ code: 'trip_dates_inverted', message: 'La fecha de fin del viaje es anterior a la de inicio.' });
  }

  if (start && end && end >= start) {
    const expectedDays = diffDays(start, end) + 1;
    if (data.days.length > 0 && data.days.length !== expectedDays) {
      warnings.push({
        code: 'day_count_mismatch',
        message: `El PDF trae ${data.days.length} días, pero las fechas del viaje (${start} a ${end}) suman ${expectedDays}.`
      });
    }
    const outside: string[] = [];
    for (const day of data.days) {
      if (day.date && (day.date < start || day.date > end)) {
        outside.push(`día ${day.number} (${day.date})`);
      }
      for (const service of day.services) {
        if (service.date && (service.date < start || service.date > end)) {
          outside.push(`"${service.name}" (${service.date})`);
        }
      }
    }
    if (outside.length > 0) {
      warnings.push({
        code: 'dates_outside_trip',
        message: `Fechas fuera del rango del viaje (${start} a ${end}): ${outside.slice(0, 8).join(', ')}${outside.length > 8 ? '…' : ''}.`
      });
    }
  }

  // --- Noches de hotel ---
  const stays = data.days
    .flatMap((d) => d.services)
    .filter((s) => s.type === 'hotel' && s.hotel?.check_in_date && s.hotel?.check_out_date)
    .map((s) => ({ name: s.name, from: s.hotel!.check_in_date!, to: s.hotel!.check_out_date! }))
    .filter((s) => s.to > s.from);

  if (stays.length > 0) {
    const overlaps: string[] = [];
    for (let i = 0; i < stays.length; i++) {
      for (let j = i + 1; j < stays.length; j++) {
        if (stays[i].from < stays[j].to && stays[j].from < stays[i].to) {
          overlaps.push(`"${stays[i].name}" y "${stays[j].name}"`);
        }
      }
    }
    if (overlaps.length > 0) {
      warnings.push({ code: 'hotel_nights_overlap', message: `Hoteles con noches que se traslapan: ${overlaps.join('; ')}.` });
    }

    if (start && end && end > start) {
      const covered = new Set<string>();
      for (const stay of stays) {
        for (let d = stay.from; d < stay.to; d = addDays(d, 1)) {
          covered.add(d);
        }
      }
      const uncovered: string[] = [];
      for (let d = start; d < end; d = addDays(d, 1)) {
        if (!covered.has(d)) {
          uncovered.push(d);
        }
      }
      if (uncovered.length > 0) {
        warnings.push({
          code: 'hotel_nights_uncovered',
          message: `Noches sin hotel (${uncovered.length}): ${describeRanges(uncovered)}.`
        });
      }
    }
  }

  return warnings;
}
