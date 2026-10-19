// Limpieza determinista de datos sensibles sobre TODO el texto extraído.
//
// Red de seguridad para el prompt de sistema (que ya prohíbe extraerlos): si el modelo
// deja pasar un número de boleto, un pasaporte o documento, una fecha de nacimiento,
// un localizador, un asiento o datos de tarjeta, aquí se elimina del texto y se registra
// un warning genérico (PRIVACY_NOTICE) — sin el valor, sin la categoría y sin la ruta del campo.
//
// Alcance y límites (heurísticas, no una garantía):
//  - boletos: 13 dígitos (con o sin guion/espacio tras los 3 primeros).
//  - pasaportes / documentos: una etiqueta (pasaporte, DNI, cédula, RUT, CURP…) seguida de un
//    valor con dígitos, o un código suelto de 1–2 letras mayúsculas + 6–8 dígitos.
//  - fechas de nacimiento: solo con etiqueta ("fecha de nacimiento", "DOB"…). Una fecha suelta
//    no se puede distinguir de una fecha del viaje, así que no se toca.
//  - localizadores / reservas: etiqueta + código con al menos un dígito (uno solo de letras no se detecta).
//  - asientos: etiqueta (asiento, seat) + fila y letra, p. ej. "12A".
//  - tarjetas: etiqueta + dígitos, tarjetas enmascaradas, o 13–19 dígitos que pasan Luhn.
// Se omiten client.phone y client.email (un teléfono internacional puede tener 13 dígitos).
import type { Extraction, ExtractionWarning } from './proposal-extraction.ts';

export type SensitiveCategory = 'tickets' | 'documents' | 'birthdates' | 'bookings' | 'seats' | 'cards';

/**
 * Aviso para la asesora cuando el documento traía datos personales que no se incorporan a la propuesta.
 * Deliberadamente genérico: no dice qué dato se encontró (pasaporte, nacimiento, boleto…), solo que hubo.
 * Lo usan también el posprocesado (datos que el modelo omitió) y la vista previa.
 */
export const PRIVACY_NOTICE = 'Algunos datos personales del documento no se incorporan a la propuesta.';

const SEP = String.raw`[\s:#\-–]*`;
const NO = String.raw`(?:n(?:ro|[°º]|o)?\.?\s*)?`; // "N°", "No.", "nro"
const NOT_LETTER_BEFORE = String.raw`(?<![\p{L}\d])`;

const DATE_VALUE = String.raw`(?:\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}|\d{1,2}\s+(?:de\s+)?\p{L}{3,10}\.?\s+(?:de\s+)?\d{2,4}|\p{L}{3,9}\s+\d{1,2},?\s+\d{4})`;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) {
        n -= 9;
      }
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

interface Rule {
  category: SensitiveCategory;
  pattern: RegExp;
  /** Si devuelve false, la coincidencia no se elimina. */
  accept?: (match: string) => boolean;
}

const RULES: Rule[] = [
  // Boleto electrónico: 13 dígitos, p. ej. 1234567890123 o 123-4567890123.
  { category: 'tickets', pattern: new RegExp(String.raw`(?<!\d)\d{3}[\s-]?\d{10}(?!\d)`, 'gu') },

  // Tarjetas: enmascaradas, con etiqueta, o numeración larga que pasa Luhn.
  { category: 'cards', pattern: new RegExp(String.raw`(?:[*xX•]{4}[\s-]?){1,3}\d{4}`, 'gu') },
  {
    category: 'cards',
    pattern: new RegExp(
      String.raw`${NOT_LETTER_BEFORE}(?:tarjeta|card|visa|master\s*card|amex|american\s+express|cr[ée]dito|d[ée]bito)(?![\p{L}])[^\n\d]{0,24}(?:\d[ -]?){4,18}\d`,
      'giu'
    )
  },
  {
    category: 'cards',
    pattern: new RegExp(String.raw`(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)`, 'gu'),
    // Solo formas habituales de tarjeta (13–19 seguidos, o grupos de 4 / formato Amex) que pasan Luhn: así no se
    // confunden rangos de fechas ni teléfonos con espacios.
    accept: (m) =>
      (/^\d{13,19}$/.test(m) || /^(?:\d{4}[ -]){2,3}\d{1,4}$/.test(m) || /^\d{4}[ -]\d{6}[ -]\d{5}$/.test(m)) && luhn(m.replace(/\D/g, ''))
  },

  // Pasaportes y documentos de identidad (con etiqueta).
  {
    category: 'documents',
    pattern: new RegExp(
      String.raw`${NOT_LETTER_BEFORE}(?:n[úu]mero\s+de\s+)?(?:pasaporte|passport|pasap\.?|dni|c[ée]dula(?:\s+de\s+identidad)?|documento(?:\s+de\s+identidad)?|doc\.?\s*(?:de\s+)?id\.?|rut|run|curp|nif|nie|c\.?i\.?|id\s+card)(?![\p{L}])${SEP}${NO}${SEP}(?=[\p{L}\d.\-]*\d)[\p{L}\d.\-]{5,15}(?![\p{L}\d])`,
      'giu'
    )
  },
  // Código de pasaporte suelto: 1–2 letras mayúsculas + 6–8 dígitos (sin la bandera "i").
  { category: 'documents', pattern: new RegExp(String.raw`(?<![\p{L}\d])[A-Z]{1,2}\d{6,8}(?![\p{L}\d])`, 'gu') },

  // Fecha de nacimiento (solo con etiqueta).
  {
    category: 'birthdates',
    pattern: new RegExp(
      String.raw`${NOT_LETTER_BEFORE}(?:fecha\s+de\s+nacimiento|f\.?\s*(?:de\s+)?nac(?:imiento)?\.?|nacimiento|date\s+of\s+birth|birth\s*date|d\.?o\.?b\.?|born)(?![\p{L}])${SEP}${DATE_VALUE}`,
      'giu'
    )
  },

  // Localizadores y códigos de reserva (etiqueta + código con al menos un dígito).
  {
    category: 'bookings',
    pattern: new RegExp(
      String.raw`${NOT_LETTER_BEFORE}(?:localizador|c[óo]digo\s+de\s+reserva|c[óo]d\.?\s*(?:de\s+)?reserva|n[úu]mero\s+de\s+reserva|reserva\s*(?:n(?:ro|[°º]|o)\.?|#)|booking\s+(?:ref(?:erence)?|code|number)|confirmation\s+(?:code|number)|confirmaci[óo]n\s*(?:n(?:ro|[°º]|o)\.?|#)|reservation\s+(?:code|number)|pnr|record\s+locator)(?![\p{L}])${SEP}(?=[\p{L}\d\-]*\d)[\p{L}\d\-]{5,14}(?![\p{L}\d])`,
      'giu'
    )
  },

  // Asientos: etiqueta + fila y letra (12A, 12A/12B).
  {
    category: 'seats',
    pattern: new RegExp(
      String.raw`${NOT_LETTER_BEFORE}(?:asientos?|seats?|plaza)(?![\p{L}])${SEP}\d{1,2}[A-K](?:\s*(?:[,/y&]|and)\s*\d{1,2}[A-K])*(?![\p{L}\d])`,
      'giu'
    )
  }
];

/** Texto sin los datos sensibles, y cuántos se quitaron por categoría. */
export function scrubText(text: string): { text: string; removed: Partial<Record<SensitiveCategory, number>> } {
  const removed: Partial<Record<SensitiveCategory, number>> = {};
  let result = text;
  for (const rule of RULES) {
    result = result.replace(rule.pattern, (match) => {
      if (rule.accept && !rule.accept(match)) {
        return match;
      }
      removed[rule.category] = (removed[rule.category] ?? 0) + 1;
      return '';
    });
  }
  if (Object.keys(removed).length > 0) {
    result = result
      .replace(/\(\s*\)/g, '')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:])/g, '$1')
      .replace(/^[\s,;:\-–]+|[\s,;:\-–]+$/g, '');
  }
  return { text: result, removed };
}

const SKIP_KEYS = new Set(['phone', 'email']);
/** Campos de texto obligatorios (no nulos): si quedan vacíos tras la limpieza se les pone un marcador. */
const REQUIRED_TEXT_KEYS = new Set(['name', 'concept']);
const EMPTY_PLACEHOLDER = '(sin nombre)';

export function scrubSensitive(input: Extraction): { data: Extraction; warnings: ExtractionWarning[] } {
  const data = structuredClone(input);
  let removedAny = false;

  const visit = (node: unknown, key: string): unknown => {
    if (typeof node === 'string') {
      if (SKIP_KEYS.has(key)) {
        return node;
      }
      const { text, removed } = scrubText(node);
      if (Object.keys(removed).length === 0) {
        return node;
      }
      removedAny = true;
      return text === '' && REQUIRED_TEXT_KEYS.has(key) ? EMPTY_PLACEHOLDER : text;
    }
    if (Array.isArray(node)) {
      const items = node.map((item) => visit(item, key));
      // Un elemento de texto que queda vacío ya no aporta nada.
      return items.filter((item) => item !== '');
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(node)) {
        out[k] = visit(v, k);
      }
      return out;
    }
    return node;
  };

  const cleaned = visit(data, '') as Extraction;
  // El aviso no revela qué dato ni dónde estaba: solo que algo personal no se incorpora.
  return {
    data: cleaned,
    warnings: removedAny ? [{ code: 'sensitive_data_removed', message: PRIVACY_NOTICE }] : []
  };
}
