const DIACRITIC_START = 0x0300;
const DIACRITIC_END = 0x036f;
const COMBINING_MARKS = new RegExp(`[\\u${DIACRITIC_START.toString(16).padStart(4, '0')}-\\u${DIACRITIC_END.toString(16).padStart(4, '0')}]`, 'g');

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
