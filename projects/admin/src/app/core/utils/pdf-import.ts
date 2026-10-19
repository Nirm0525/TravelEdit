/** Utilidades puras de la pantalla "Nueva desde PDF" (validación del archivo y sondeo del estado). */

export const MAX_PDF_BYTES = 20 * 1024 * 1024;

/** Mensaje claro si el archivo no cumple; null si es válido. Solo comprobaciones en el cliente: el servidor revisa de nuevo. */
export function validatePdfFile(file: Pick<File, 'name' | 'size' | 'type'>): string | null {
  const isPdfName = /\.pdf$/i.test(file.name);
  const isPdfType = file.type === '' || file.type === 'application/pdf';
  if (!isPdfName || !isPdfType) {
    return 'Solo se aceptan archivos PDF (.pdf).';
  }
  if (file.size === 0) {
    return 'El archivo está vacío.';
  }
  if (file.size > MAX_PDF_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1).replace('.', ',');
    return `El archivo pesa ${mb} MB y el máximo es 20 MB.`;
  }
  return null;
}

/** Ruta en Storage: siempre <id del usuario>/<uuid>.pdf en minúsculas; el nombre original del archivo nunca interviene. */
export function importStoragePath(userId: string, uuid: string = crypto.randomUUID()): string {
  return `${userId}/${uuid}.pdf`.toLowerCase();
}

export const POLL_INTERVAL_MS = 3000;
export const POLL_TIMEOUT_MS = 3 * 60 * 1000;

export interface PollableStatus {
  status: string;
}

export interface PollOptions {
  intervalMs?: number;
  timeoutMs?: number;
  /** Si devuelve true se deja de sondear (p. ej. la persona salió de la pantalla). */
  cancelled?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Estados en los que ya no hace falta seguir esperando. */
const FINAL_STATUSES = new Set(['ready', 'failed', 'applied']);

/**
 * Consulta el estado cada `intervalMs` hasta que llega a ready/failed/applied.
 * Devuelve la última fila, o 'timeout' si pasan `timeoutMs` (3 minutos) sin terminar, o 'cancelled'.
 */
export async function pollImportStatus<T extends PollableStatus>(
  fetchStatus: () => Promise<T>,
  options: PollOptions = {}
): Promise<T | 'timeout' | 'cancelled'> {
  const intervalMs = options.intervalMs ?? POLL_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const startedAt = now();

  for (;;) {
    if (options.cancelled?.()) {
      return 'cancelled';
    }
    const row = await fetchStatus();
    if (FINAL_STATUSES.has(row.status)) {
      return row;
    }
    if (now() - startedAt >= timeoutMs) {
      return 'timeout';
    }
    await sleep(intervalMs);
  }
}
