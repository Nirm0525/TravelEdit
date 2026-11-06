// Núcleo compartido de geocode-place: tipos, configuración por proveedor, claves de caché y lectura de rechazos. Solo lógica pura:
// sin Deno.* ni supabase-js. Los adaptadores (nominatim.ts, geoapify.ts) solo traducen la API de cada proveedor a GeocodeCandidate.
//
// Proveedores:
//  - geoapify (predeterminado): requiere GEOAPIFY_API_KEY, solo como secret del servidor (nunca en logs, respuestas ni documentos).
//  - nominatim: SOLO si se elige explícitamente con GEOCODER_PROVIDER=nominatim. Nunca es un respaldo automático del otro.

export type OsmType = 'node' | 'way' | 'relation';
export type Geocoder = 'nominatim' | 'geoapify';

/** Un candidato ya normalizado y validado (lo único que sale de esta función hacia Angular). */
export interface GeocodeCandidate {
  /** Proveedor del MAPA de las coordenadas (siempre OpenStreetMap). */
  provider: 'osm';
  /** Quién geocodificó: determina la atribución obligatoria. */
  geocoder: Geocoder;
  /** Identificador del lugar en el geocodificador (p. ej. place_id de Geoapify); null si no lo da. */
  placeId: string | null;
  /** Identificador OSM: SOLO si el proveedor lo informa (no todo resultado lo tiene). */
  osmType: OsmType | null;
  osmId: number | null;
  name: string;
  address: string;
  lat: number;
  lon: number;
  /** [sur, oeste, norte, este] en grados; null si el proveedor no lo da o no es coherente. */
  bbox: [number, number, number, number] | null;
  /** Procedencia de los datos según el proveedor (p. ej. «openstreetmap»), su atribución y su licencia, en texto plano. */
  dataSource: string | null;
  attribution: string | null;
  license: string | null;
  /** Ciudad y país del resultado (solo si el proveedor los informa): ayudan a distinguir homónimos en las sugerencias. */
  city?: string | null;
  country?: string | null;
}

/** Búsqueda completa (botón): hasta 3 candidatos. Autocompletado (al escribir): hasta 5 sugerencias. */
export type SearchMode = 'search' | 'autocomplete';

/** Preferencia geográfica (proximidad) para el autocompletado; coordenadas ya redondeadas. */
export interface SearchBias {
  lat: number;
  lon: number;
}

/** Lo que se pide al proveedor: el modo, la consulta normalizada y, solo en autocompletado, la preferencia geográfica. */
export interface SearchRequest {
  mode: SearchMode;
  query: string;
  bias: SearchBias | null;
}

export const MAX_RESULTS = 3;
export const MAX_SUGGESTIONS = 5;
export const maxResultsFor = (mode: SearchMode): number => (mode === 'autocomplete' ? MAX_SUGGESTIONS : MAX_RESULTS);
export const MIN_QUERY_LENGTH = 3;
/** El autocompletado no se pide con menos caracteres (el navegador espera 4, pero el servidor también lo exige). */
export const MIN_SUGGEST_LENGTH = 4;
export const MAX_QUERY_LENGTH = 200;
export const ATTRIBUTION = '© OpenStreetMap contributors';

/** Hash FNV-1a de 32 bits con semilla (no criptográfico: solo para acortar el ámbito de caché). */
function fnv1a(text: string, seed: number): string {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * Ámbito de la caché, del turno global y del límite diario: proveedor + endpoint. Otro proveedor o URL base NUNCA reutiliza entradas,
 * turnos ni consumo ajenos. NO incluye la clave de API. ≤ 40 caracteres (límite de las columnas).
 */
export function cacheScope(config: Pick<GeocoderConfig, 'provider' | 'baseUrl'>): string {
  return `${config.provider}:${fnv1a(config.baseUrl, 0x811c9dc5)}${fnv1a(config.baseUrl, 0x9747b28c)}`;
}

/** Versión del formato de los candidatos guardados: súbela si cambia GeocodeCandidate o la consulta al proveedor. */
export const CACHE_FORMAT_VERSION = 'v2';

/** Versión del formato de las sugerencias (autocompletado): independiente de la de las búsquedas completas. */
export const SUGGEST_FORMAT_VERSION = 'v3';

/** Redondea la preferencia geográfica a 0,1° (~11 km): es una preferencia blanda y así consultas cercanas comparten caché. */
export function roundBias(lat: number, lon: number): SearchBias {
  return { lat: Math.round(lat * 10) / 10, lon: Math.round(lon * 10) / 10 };
}

/**
 * Clave de caché. Búsqueda completa: versión + idioma + consulta (sin cambios). Autocompletado: otra familia de claves que incluye TODO lo
 * que afecta al resultado (endpoint, límite de sugerencias, idioma, preferencia geográfica y consulta): nunca comparte entradas con la búsqueda
 * completa ni con otra preferencia u otro idioma.
 */
export function cacheKey(config: Pick<GeocoderConfig, 'language'>, normalizedQuery: string, options: { mode?: SearchMode; bias?: SearchBias | null } = {}): string {
  if (options.mode === 'autocomplete') {
    const bias = options.bias ? `prox:${options.bias.lat.toFixed(1)},${options.bias.lon.toFixed(1)}` : 'prox:none';
    return `${SUGGEST_FORMAT_VERSION}|ac${MAX_SUGGESTIONS}|${config.language}|${bias}|${normalizedQuery}`;
  }
  return `${CACHE_FORMAT_VERSION}|${config.language}|${normalizedQuery}`;
}

/** Consulta normalizada (clave de caché): NFKC, sin caracteres de control, espacios colapsados, minúsculas. */
export function normalizeQuery(raw: string): string {
  return raw
    .normalize('NFKC')
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .replace(/(^[ ,]+)|([ ,]+$)/g, '')
    .toLocaleLowerCase('es');
}

export interface GeocoderConfig {
  provider: string;
  baseUrl: string;
  /** Clave de API del proveedor (solo Geoapify). NUNCA se registra, se devuelve ni se guarda: solo viaja en la petición al proveedor. */
  apiKey: string | null;
  userAgent: string;
  language: string;
  minIntervalMs: number;
  timeoutMs: number;
  cacheTtlSeconds: number;
  emptyTtlSeconds: number;
  /** Máximo de llamadas EXTERNAS por día (UTC), compartido entre instancias (ver migración 0058). */
  dailyLimit: number;
}

interface ProviderSpec {
  baseUrl: string;
  /** Intervalo mínimo entre llamadas que NO se puede reducir por configuración. */
  minIntervalFloorMs: number;
  needsKey: boolean;
}

export const PROVIDERS: Record<string, ProviderSpec> = {
  geoapify: { baseUrl: 'https://api.geoapify.com', minIntervalFloorMs: 1000, needsKey: true },
  nominatim: { baseUrl: 'https://nominatim.openstreetmap.org', minIntervalFloorMs: 1, needsKey: false }
};
export const DEFAULT_PROVIDER = 'geoapify';

/** Mínimo exigido por la política del servicio público de OSM: 1 consulta por segundo. */
export const PUBLIC_MIN_INTERVAL_MS = 1000;
export const DEFAULT_DAILY_LIMIT = 500;
export const MAX_DAILY_LIMIT = 3000;

/**
 * ¿Es un servidor público de OpenStreetMap (sujeto a su política de uso)? Normaliza el host: mayúsculas, punto final de FQDN
 * («nominatim.openstreetmap.org.») y cualquier subdominio de openstreetmap.org. Así ninguna variante de la URL evita el mínimo.
 */
export function isPublicOsmHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  return host === 'openstreetmap.org' || host.endsWith('.openstreetmap.org');
}
const DEFAULT_USER_AGENT = 'TheTravelEdit-Admin/1.0 (+https://thetravel-edit.com)';

function positiveInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

/** User-Agent que identifica a la aplicación; GEOCODER_CONTACT_EMAIL (opcional) se añade como contacto. */
export function buildUserAgent(get: (name: string) => string | undefined): string {
  const custom = (get('GEOCODER_USER_AGENT') ?? '').trim();
  const base = custom || DEFAULT_USER_AGENT;
  const contact = (get('GEOCODER_CONTACT_EMAIL') ?? '').trim();
  return contact && !custom ? `${base.replace(/\)$/, '')}; contact: ${contact})` : base;
}

/** Clave de API con forma plausible (solo caracteres seguros para ir en una URL); cualquier otra cosa se trata como «no configurada». */
export function readApiKey(get: (name: string) => string | undefined): string | null {
  const key = (get('GEOAPIFY_API_KEY') ?? '').trim();
  return /^[A-Za-z0-9_-]{8,128}$/.test(key) ? key : null;
}

/**
 * Lee la configuración de los secrets. Un valor inválido se ignora y queda el predeterminado, salvo el proveedor y la URL base: uno
 * desconocido o una URL que no sea https se rechaza (null) para no enviar consultas a un destino inesperado o inseguro.
 */
export function readGeocoderConfig(get: (name: string) => string | undefined): GeocoderConfig | null {
  const provider = (get('GEOCODER_PROVIDER') ?? DEFAULT_PROVIDER).trim().toLowerCase() || DEFAULT_PROVIDER;
  const spec = PROVIDERS[provider];
  if (!/^[a-z0-9_-]{1,20}$/.test(provider) || !spec) {
    return null;
  }
  const rawBase = (get('GEOCODER_BASE_URL') ?? spec.baseUrl).trim();
  let base: URL;
  try {
    base = new URL(rawBase);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || base.username || base.password) {
    return null;
  }
  const language = (get('GEOCODER_LANGUAGE') ?? 'es').trim();
  // Mínimo por proveedor (Geoapify: 1 petición por segundo) y, en servidores públicos de OSM, el exigido por su política: no se
  // puede configurar menos, ni siquiera por error (ni con mayúsculas, punto final, subdominios, puerto o ruta: ver isPublicOsmHost).
  const floor = Math.max(spec.minIntervalFloorMs, isPublicOsmHost(base.hostname) ? PUBLIC_MIN_INTERVAL_MS : 1);
  return {
    provider,
    baseUrl: `${base.origin}${base.pathname.replace(/\/+$/, '')}`,
    apiKey: spec.needsKey ? readApiKey(get) : null,
    userAgent: buildUserAgent(get),
    language: /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(language) ? language : 'es',
    minIntervalMs: Math.max(floor, positiveInt(get('GEOCODER_MIN_INTERVAL_MS'), 1100, 1, 60_000)),
    timeoutMs: positiveInt(get('GEOCODER_TIMEOUT_MS'), 8000, 1000, 20_000),
    cacheTtlSeconds: positiveInt(get('GEOCODER_CACHE_DAYS'), 30, 1, 365) * 86_400,
    emptyTtlSeconds: positiveInt(get('GEOCODER_EMPTY_CACHE_HOURS'), 24, 1, 720) * 3_600,
    dailyLimit: positiveInt(get('GEOCODER_DAILY_LIMIT'), DEFAULT_DAILY_LIMIT, 1, MAX_DAILY_LIMIT)
  };
}

/** ¿Falta la clave que exige el proveedor configurado? (Sin clave NO se hace ninguna llamada.) */
export function missingApiKey(config: GeocoderConfig): boolean {
  return !!PROVIDERS[config.provider]?.needsKey && !config.apiKey;
}

// ---------------------------------------------------------------- utilidades de validación

export const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function toNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

export const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Texto plano del proveedor: sin caracteres de control ni «<»/«>», recortado; null si queda vacío. Nunca se interpreta como HTML. */
export function plainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  // deno-lint-ignore no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || null;
}

/** Recuadro [sur, oeste, norte, este] válido (en rango y ordenado) o null. */
export function validBbox(s: number | null, w: number | null, n: number | null, e: number | null): GeocodeCandidate['bbox'] {
  if (s === null || w === null || n === null || e === null || s > n || w > e || s < -90 || n > 90 || w < -180 || e > 180) {
    return null;
  }
  return [round6(s), round6(w), round6(n), round6(e)];
}

/** Hasta MAX_RESULTS candidatos distintos (por geocodificador+id, tipo OSM+id, o coordenadas). */
export function uniqueCandidates(candidates: Iterable<GeocodeCandidate | null>, max: number = MAX_RESULTS): GeocodeCandidate[] {
  const seen = new Set<string>();
  const out: GeocodeCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    const key = candidate.placeId
      ? `${candidate.geocoder}/${candidate.placeId}`
      : candidate.osmType && candidate.osmId
        ? `${candidate.osmType}/${candidate.osmId}`
        : `${candidate.lat},${candidate.lon}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(candidate);
    if (out.length >= max) {
      break;
    }
  }
  return out;
}

/** Ciudad y país solo si existen (los candidatos de búsquedas anteriores no los tienen y no se rellenan con null). */
export function optionalPlace(item: Record<string, unknown>): { city?: string; country?: string } {
  const city = plainText(item.city, 100);
  const country = plainText(item.country, 100);
  return { ...(city ? { city } : {}), ...(country ? { country } : {}) };
}

const OSM_TYPES = new Set<string>(['node', 'way', 'relation']);

/** Revalida lo leído de la caché (la base es de confianza, pero el contenido se vuelve a comprobar antes de usarlo). */
export function parseCachedCandidates(value: unknown, max: number = MAX_RESULTS): GeocodeCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: GeocodeCandidate[] = [];
  for (const item of value) {
    if (!isRecord(item) || item.provider !== 'osm') {
      continue;
    }
    const lat = toNumber(item.lat);
    const lon = toNumber(item.lon);
    const name = plainText(item.name, 200);
    if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180 || !name) {
      continue;
    }
    const box = Array.isArray(item.bbox) && item.bbox.length === 4 ? item.bbox.map(toNumber) : null;
    const placeId = typeof item.placeId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(item.placeId) ? item.placeId : null;
    out.push({
      provider: 'osm',
      geocoder: item.geocoder === 'geoapify' ? 'geoapify' : 'nominatim',
      placeId,
      osmType: typeof item.osmType === 'string' && OSM_TYPES.has(item.osmType) ? (item.osmType as OsmType) : null,
      osmId: typeof item.osmId === 'number' && Number.isSafeInteger(item.osmId) && item.osmId > 0 ? item.osmId : null,
      name,
      address: plainText(item.address, 300) ?? '',
      lat: round6(lat),
      lon: round6(lon),
      bbox: box ? validBbox(box[0] ?? null, box[1] ?? null, box[2] ?? null, box[3] ?? null) : null,
      dataSource: plainText(item.dataSource, 40),
      attribution: plainText(item.attribution, 200),
      license: plainText(item.license, 60),
      ...optionalPlace(item)
    });
  }
  return out.slice(0, max);
}

// ---------------------------------------------------------------- respuestas del proveedor

/** Lo que devolvió el proveedor cuando NO dio resultados: estado real, Retry-After tal cual y un extracto de su mensaje (para los logs). */
export interface ProviderRejection {
  status: number;
  /** Segundos que pidió esperar (cabecera Retry-After, en segundos o fecha HTTP); null si no la envió. */
  retryAfterSeconds: number | null;
  /** El valor crudo de Retry-After, o null. */
  retryAfterHeader: string | null;
  /** Primeros caracteres del cuerpo de la respuesta (mensaje del proveedor), SIN la clave de API; nunca la consulta ni datos del cliente. */
  bodyHint: string;
}

export type SearchOutcome =
  | { kind: 'ok'; results: GeocodeCandidate[] }
  /** 429 / 403 / 503 (y 401/402 de Geoapify): hay que dejar de consultarlo un rato. */
  | ({ kind: 'limited' } & ProviderRejection)
  | ({ kind: 'error' } & ProviderRejection);

/** Retry-After: número de segundos o fecha HTTP. null si falta o no es válido; nunca negativo. */
export function parseRetryAfter(value: string | null, nowMs: number = Date.now()): number | null {
  const text = value?.trim();
  if (!text) {
    return null;
  }
  if (/^\d+$/.test(text)) {
    const seconds = Number(text);
    return seconds > 0 ? seconds : null;
  }
  const at = Date.parse(text);
  if (Number.isNaN(at)) {
    return null;
  }
  const seconds = Math.ceil((at - nowMs) / 1000);
  return seconds > 0 ? seconds : null;
}

/** Quita la clave de API (tal cual o como parámetro «apiKey=…») de cualquier texto que vaya a registrarse. */
export function redactSecrets(text: string, secret: string | null): string {
  let out = text.replace(/(api[_-]?key=)[^&\s"']*/gi, '$1[redacted]');
  if (secret) {
    out = out.split(secret).join('[redacted]');
  }
  return out;
}

export async function readRejection(response: Response, secret: string | null = null): Promise<ProviderRejection> {
  const retryAfterHeader = response.headers.get('retry-after');
  const text = await response.text().catch(() => '');
  return {
    status: response.status,
    retryAfterSeconds: parseRetryAfter(retryAfterHeader),
    retryAfterHeader,
    bodyHint: redactSecrets(text.replace(/\s+/g, ' ').trim().slice(0, 200), secret)
  };
}
