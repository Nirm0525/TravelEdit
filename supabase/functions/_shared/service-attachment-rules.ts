// Reglas de los documentos adjuntos por servicio del itinerario — única fuente para las dos Edge Functions
// (proposal-service-files: admin, y proposal-documents: cliente) y para sus tests.
//
// Los archivos pueden ser sensibles (boletos, vouchers): se aceptan pocos tipos, se comprueba el tipo REAL con los
// primeros bytes (no solo el MIME que declara el navegador), el nombre original solo se guarda para mostrar y la
// ruta de Storage la genera siempre el servidor.

export const SERVICE_FILES_BUCKET = 'proposal-service-files';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_SERVICE = 10;
/** Vida de las URLs firmadas de lectura (10 minutos). Nunca se guardan en la base. */
export const SIGNED_URL_TTL_SECONDS = 600;
/** Cuántos bytes iniciales se leen para comprobar el tipo real. */
export const SNIFF_BYTES = 16;

export type AttachmentKind = 'pdf' | 'jpeg' | 'png' | 'webp';

interface KindInfo {
  mime: string;
  /** Extensión con la que se guarda en Storage (derivada del tipo validado, no del nombre del archivo). */
  ext: string;
  /** Extensiones aceptadas en el nombre original. */
  extensions: string[];
}

export const KINDS: Record<AttachmentKind, KindInfo> = {
  pdf: { mime: 'application/pdf', ext: 'pdf', extensions: ['pdf'] },
  jpeg: { mime: 'image/jpeg', ext: 'jpg', extensions: ['jpg', 'jpeg'] },
  png: { mime: 'image/png', ext: 'png', extensions: ['png'] },
  webp: { mime: 'image/webp', ext: 'webp', extensions: ['webp'] }
};

export const ALLOWED_MIME_TYPES = Object.values(KINDS).map((k) => k.mime);

const KIND_BY_MIME = new Map<string, AttachmentKind>(
  (Object.entries(KINDS) as [AttachmentKind, KindInfo][]).map(([kind, info]) => [info.mime, kind])
);
const KIND_BY_EXT = new Map<string, AttachmentKind>(
  (Object.entries(KINDS) as [AttachmentKind, KindInfo][]).flatMap(([kind, info]) => info.extensions.map((e) => [e, kind] as [string, AttachmentKind]))
);

export type RuleError = 'invalid_name' | 'invalid_size' | 'invalid_mime' | 'invalid_extension' | 'empty_file' | 'too_large';

export const RULE_MESSAGES: Record<RuleError, string> = {
  invalid_name: 'El nombre del archivo no es válido.',
  invalid_size: 'El tamaño del archivo no es válido.',
  invalid_mime: 'Tipo de archivo no permitido. Usa PDF, JPEG, PNG o WebP.',
  invalid_extension: 'La extensión del archivo no es válida. Usa .pdf, .jpg, .jpeg, .png o .webp.',
  empty_file: 'El archivo está vacío.',
  too_large: 'El archivo supera el máximo de 10 MB.'
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Ids de servicio aceptados en rutas de Storage: sin separadores ni caracteres raros. */
const SERVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isSafeServiceId = (value: unknown): value is string => typeof value === 'string' && SERVICE_ID.test(value);

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot < 0 ? '' : fileName.slice(dot + 1).trim().toLowerCase();
}

/**
 * Valida lo que el navegador DECLARA antes de autorizar la subida: nombre, MIME, extensión y tamaño.
 * El tipo real se comprueba después, al finalizar, con los bytes del objeto subido.
 */
export function validateUploadRequest(input: {
  fileName: unknown;
  mimeType: unknown;
  fileSize: unknown;
}): { ok: true; kind: AttachmentKind } | { ok: false; error: RuleError } {
  const { fileName, mimeType, fileSize } = input;
  if (typeof fileName !== 'string' || fileName.trim() === '' || fileName.length > 255) {
    return { ok: false, error: 'invalid_name' };
  }
  if (typeof mimeType !== 'string') {
    return { ok: false, error: 'invalid_mime' };
  }
  const kind = KIND_BY_MIME.get(mimeType.trim().toLowerCase());
  if (!kind) {
    return { ok: false, error: 'invalid_mime' };
  }
  const byExt = KIND_BY_EXT.get(extensionOf(fileName));
  if (byExt !== kind) {
    return { ok: false, error: 'invalid_extension' };
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || !Number.isInteger(fileSize) || fileSize < 0) {
    return { ok: false, error: 'invalid_size' };
  }
  if (fileSize === 0) {
    return { ok: false, error: 'empty_file' };
  }
  if (fileSize > MAX_FILE_BYTES) {
    return { ok: false, error: 'too_large' };
  }
  return { ok: true, kind };
}

/** Tipo real según los primeros bytes; null si no es uno de los permitidos. */
export function sniffKind(bytes: Uint8Array): AttachmentKind | null {
  const startsWith = (sig: number[], offset = 0) => sig.every((b, i) => bytes[offset + i] === b);
  if (bytes.length >= 5 && startsWith([0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return 'pdf'; // %PDF-
  }
  if (bytes.length >= 3 && startsWith([0xff, 0xd8, 0xff])) {
    return 'jpeg';
  }
  if (bytes.length >= 8 && startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png';
  }
  if (bytes.length >= 12 && startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return 'webp'; // RIFF....WEBP
  }
  return null;
}

/**
 * Nombre para mostrar: sin rutas ni caracteres de control, acotado, y siempre con la extensión del tipo real
 * (si el original no la trae o no coincide, se añade).
 */
export function sanitizeDisplayName(fileName: unknown, kind: AttachmentKind): string {
  const raw = typeof fileName === 'string' ? fileName : '';
  let name = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').split(/[\\/]/).pop()!.replace(/\s+/g, ' ').trim();
  name = name.replace(/^\.+/, '').trim();
  const { ext, extensions } = KINDS[kind];
  const hasExt = extensions.includes(extensionOf(name));
  if (name === '' || name === `.${ext}`) {
    return `documento.${ext}`;
  }
  if (!hasExt) {
    name = `${name}.${ext}`;
  }
  if (name.length > 200) {
    const keep = 200 - ext.length - 1;
    name = `${name.slice(0, keep).trimEnd()}.${ext}`;
  }
  return name;
}

// ---------------------------------------------------------------- rutas de Storage

const PATH = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([A-Za-z0-9_-]{1,64})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(pdf|jpg|png|webp)$/i;

/** <proposal_id>/<service_id>/<uuid>.<ext> — el uuid es aleatorio; el nombre original no interviene. */
export function buildStoragePath(proposalId: string, serviceId: string, kind: AttachmentKind, id: string = crypto.randomUUID()): string {
  return `${proposalId}/${serviceId}/${id}.${KINDS[kind].ext}`;
}

export function parseStoragePath(path: unknown): { proposalId: string; serviceId: string; id: string; ext: string; kind: AttachmentKind } | null {
  if (typeof path !== 'string') {
    return null;
  }
  const m = PATH.exec(path);
  if (!m) {
    return null;
  }
  const ext = m[4].toLowerCase();
  const kind = (Object.keys(KINDS) as AttachmentKind[]).find((k) => KINDS[k].ext === ext)!;
  return { proposalId: m[1].toLowerCase(), serviceId: m[2], id: m[3].toLowerCase(), ext, kind };
}

// ---------------------------------------------------------------- contenido de la propuesta

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Días del contenido (vacío si el contenido no es un objeto con `days`). */
export function daysOf(content: unknown): Rec[] {
  return isRec(content) && Array.isArray(content.days) ? content.days.filter(isRec) : [];
}

function servicesOf(day: Rec): Rec[] {
  return Array.isArray(day.services) ? day.services.filter(isRec) : [];
}

/** ¿Existe ese servicio dentro del contenido de ESTA propuesta (opcionalmente, dentro de ese día)? */
export function serviceExists(content: unknown, serviceId: string, dayId?: string): boolean {
  return daysOf(content).some((d) => (dayId === undefined || d.id === dayId) && servicesOf(d).some((s) => s.id === serviceId));
}

export function serviceIdsOfDay(content: unknown, dayId: string): string[] | null {
  const day = daysOf(content).find((d) => d.id === dayId);
  return day ? servicesOf(day).map((s) => String(s.id)) : null;
}

/** Contenido sin ese servicio; el resto queda intacto. */
export function withoutService(content: Rec, serviceId: string): Rec {
  return {
    ...content,
    days: daysOf(content).map((d) => (Array.isArray(d.services) ? { ...d, services: d.services.filter((s) => !(isRec(s) && s.id === serviceId)) } : d))
  };
}

/** Contenido sin ese día; los días que quedan se renumeran igual que el editor. */
export function withoutDay(content: Rec, dayId: string): Rec {
  return {
    ...content,
    days: daysOf(content)
      .filter((d) => d.id !== dayId)
      .map((d, index) => ({ ...d, dayNumber: index + 1 }))
  };
}
