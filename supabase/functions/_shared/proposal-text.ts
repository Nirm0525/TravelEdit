// Utilidades de texto/fecha compartidas por el diff y las revisiones de coherencia.

/** Minúsculas, sin tildes, sin signos de puntuación ni espacios repetidos. */
export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "9:30 a. m.", "9:30 AM", "21:15", "9 pm" → "HH:MM". Texto como "Mañana" → null. */
export function parseTimeToHHMM(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const cleaned = value.replace(/ /g, ' ').trim().toLowerCase();
  const match = /^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)?$/.exec(cleaned);
  if (!match) {
    return null;
  }
  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridian = match[3]?.replace(/[^ap]/g, '');
  if (minutes > 59) {
    return null;
  }
  if (meridian) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = meridian === 'p' ? (hours % 12) + 12 : hours % 12;
  } else if (hours > 23) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const DAY_MS = 86_400_000;

function toUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtc(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Días entre dos fechas ISO (b − a). */
export function diffDays(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}
