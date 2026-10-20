/**
 * Utilidades puras de los documentos por servicio. Son comprobaciones de comodidad en el navegador: el servidor
 * (Edge Function proposal-service-files) vuelve a validar tipo, extensión, tamaño y contenido real del archivo.
 */

export const ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const ATTACHMENT_MAX_PER_SERVICE = 10;
/** Solo para el atributo `accept` del selector: ayuda al usuario, no protege nada. */
export const ATTACHMENT_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp';

const EXTENSIONS_BY_MIME: Record<string, string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp']
};

/** Mensaje claro si el archivo no cumple; null si es válido. */
export function validateAttachmentFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const extensions = EXTENSIONS_BY_MIME[file.type.toLowerCase()];
  if (!extensions) {
    return 'Tipo de archivo no permitido. Usa PDF, JPEG, PNG o WebP.';
  }
  const ext = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (!extensions.includes(ext)) {
    return 'La extensión del archivo no coincide con su tipo. Usa .pdf, .jpg, .jpeg, .png o .webp.';
  }
  if (file.size === 0) {
    return 'El archivo está vacío.';
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return `El archivo pesa ${formatFileSize(file.size)} y el máximo es 10 MB.`;
  }
  return null;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}

/** "Boleto aéreo CM385.pdf" → "Boleto aéreo CM385" (así lo lee el cliente). */
export function displayNameWithoutExtension(fileName: string): string {
  const stripped = fileName.replace(/\.(pdf|jpe?g|png|webp)$/i, '').trim();
  return stripped === '' ? fileName : stripped;
}
