// Validación del PDF antes de gastar una llamada a la API. Límites de OpenAI (archivos PDF): cada
// archivo menos de 50 MB y 50 MB en total por solicitud; la documentación no da un límite de páginas, así
// que el tope de páginas (PDF_MAX_PAGES, 100 por defecto) es nuestra propia guarda de costo y tiempo.
// No se admiten PDF cifrados.
export const MAX_PDF_BYTES = 20 * 1024 * 1024;
export const MAX_REQUEST_BYTES = 49 * 1024 * 1024; // el límite es 50 MB; se deja margen para el texto
export const DEFAULT_MAX_PAGES = 100;

/** Error con un mensaje apto para la asesora (español, sin detalles técnicos). */
export class UserError extends Error {
  constructor(message: string, public readonly technical?: string) {
    super(message);
    this.name = 'UserError';
  }
}

const MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function base64Length(byteLength: number): number {
  return Math.ceil(byteLength / 3) * 4;
}

/** Cuenta páginas de forma aproximada leyendo el PDF como texto. null = no se pudo saber. */
export function estimatePageCount(bytes: Uint8Array): number | null {
  const text = new TextDecoder('latin1').decode(bytes);
  let pageObjects = 0;
  for (const _ of text.matchAll(/\/Type\s*\/Page(?![A-Za-z])/g)) {
    pageObjects++;
  }
  let counted = 0;
  for (const m of text.matchAll(/\/Type\s*\/Pages[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages/g)) {
    counted = Math.max(counted, Number(m[1] ?? m[2]));
  }
  const pages = Math.max(pageObjects, counted);
  return pages > 0 ? pages : null;
}

function isEncrypted(bytes: Uint8Array): boolean {
  const text = new TextDecoder('latin1').decode(bytes);
  return /\/Encrypt\s+\d+\s+\d+\s+R|\/Encrypt\s*<</.test(text);
}

export function validatePdf(bytes: Uint8Array, maxPages: number = DEFAULT_MAX_PAGES): { pages: number | null } {
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw new UserError('El PDF supera el límite de 20 MB.');
  }
  if (bytes.byteLength < MAGIC.length || !MAGIC.every((b, i) => bytes[i] === b)) {
    throw new UserError('El archivo no es un PDF válido.');
  }
  if (base64Length(bytes.byteLength) > MAX_REQUEST_BYTES) {
    throw new UserError('El PDF es demasiado pesado para procesarlo. Comprímelo o divídelo en partes.');
  }
  if (isEncrypted(bytes)) {
    throw new UserError('El PDF está protegido con contraseña. Súbelo sin protección.');
  }
  const pages = estimatePageCount(bytes);
  if (pages !== null && pages > maxPages) {
    throw new UserError(`El PDF tiene ${pages} páginas y el máximo es ${maxPages}. Divídelo en partes.`);
  }
  return { pages };
}

export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
