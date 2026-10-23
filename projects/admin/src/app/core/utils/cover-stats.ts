import { CoverStatKey, CoverStats } from '../models/proposal.model';

/** Campos del formulario de portada → un dato del Resumen: `<clave>Value` y `<clave>Label`. */
export const COVER_STAT_KEYS: readonly CoverStatKey[] = ['duration', 'travelers', 'season', 'custom'];

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const parse = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
};

/** Lo que el enlace del cliente muestra solo cuando el campo se deja vacío (misma regla que private-proposal.ts). */
export function autoCoverStats(startIso: string, endIso: string, travelers: number | null): Record<CoverStatKey, { value: string; label: string }> {
  let duration = { value: '', label: '' };
  if (startIso && endIso) {
    const nights = Math.round((parse(endIso).getTime() - parse(startIso).getTime()) / 86_400_000);
    if (nights > 0) {
      duration = { value: `${nights + 1} días`, label: `${nights} noche${nights === 1 ? '' : 's'}` };
    }
  }
  let season = { value: '', label: '' };
  if (startIso) {
    const start = parse(startIso);
    const month = start.getMonth();
    const name = month === 11 || month <= 1 ? 'Invierno' : month <= 4 ? 'Primavera' : month <= 7 ? 'Verano' : 'Otoño';
    season = { value: name, label: `${MESES[month]!.charAt(0).toUpperCase()}${MESES[month]!.slice(1)} ${start.getFullYear()}` };
  }
  return {
    duration,
    travelers: { value: travelers && travelers > 0 ? `${travelers} viajero${travelers === 1 ? '' : 's'}` : '', label: '' },
    season,
    custom: { value: 'Viaje a medida', label: 'Experiencias únicas' }
  };
}

/** Solo se guarda lo escrito: un campo vacío vuelve a ser automático. Sin nada escrito, no hay `stats`. */
export function toCoverStats(raw: Record<string, unknown>): CoverStats | undefined {
  const stats: CoverStats = {};
  for (const key of COVER_STAT_KEYS) {
    const value = String(raw[`${key}Value`] ?? '').trim();
    const label = String(raw[`${key}Label`] ?? '').trim();
    if (value || label) {
      stats[key] = { ...(value ? { value } : {}), ...(label ? { label } : {}) };
    }
  }
  return Object.keys(stats).length > 0 ? stats : undefined;
}
