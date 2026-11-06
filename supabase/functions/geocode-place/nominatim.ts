// Adaptador Nominatim (geocodificador público de OpenStreetMap). SOLO se usa si se elige explícitamente (GEOCODER_PROVIDER=nominatim):
// nunca es un respaldo automático de otro proveedor. Lógica pura y la llamada HTTP: sin Deno.* ni supabase-js.
//
// Política de uso (https://operations.osmfoundation.org/policies/nominatim/): máximo 1 consulta por segundo en total, User-Agent propio
// que identifique la aplicación, sin autocompletado, resultados cacheados, atribución a OpenStreetMap (ODbL).
//
// Lo compartido (tipos, configuración, caché, rechazos) vive en geocoder.ts y se re-exporta aquí.
import {
  MAX_RESULTS,
  isRecord,
  plainText,
  readRejection,
  round6,
  toNumber,
  uniqueCandidates,
  validBbox,
  type GeocodeCandidate,
  type GeocoderConfig,
  type SearchOutcome
} from './geocoder.ts';

export * from './geocoder.ts';

/** Convierte un elemento de la respuesta jsonv2 de Nominatim; null si no sirve (sin coordenadas válidas o sin nombre). */
export function toCandidate(item: unknown): GeocodeCandidate | null {
  if (!isRecord(item)) {
    return null;
  }
  const lat = toNumber(item.lat);
  const lon = toNumber(item.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const display = typeof item.display_name === 'string' ? item.display_name.trim() : '';
  const explicitName = typeof item.name === 'string' ? item.name.trim() : '';
  const name = (explicitName || display.split(',')[0]?.trim() || '').slice(0, 200);
  if (!name) {
    return null;
  }
  const address = (explicitName && display.startsWith(`${explicitName},`) ? display.slice(explicitName.length + 1) : display).trim().slice(0, 300);

  let bbox: GeocodeCandidate['bbox'] = null;
  if (Array.isArray(item.boundingbox) && item.boundingbox.length === 4) {
    // Nominatim: [sur, norte, oeste, este].
    const [s, n, w, e] = item.boundingbox.map(toNumber);
    bbox = validBbox(s ?? null, w ?? null, n ?? null, e ?? null);
  }
  const osmType = item.osm_type === 'node' || item.osm_type === 'way' || item.osm_type === 'relation' ? item.osm_type : null;
  const osmId = typeof item.osm_id === 'number' && Number.isSafeInteger(item.osm_id) && item.osm_id > 0 ? item.osm_id : null;
  return {
    provider: 'osm',
    geocoder: 'nominatim',
    placeId: null,
    osmType,
    osmId,
    name: plainText(name, 200) ?? name,
    address,
    lat: round6(lat),
    lon: round6(lon),
    bbox,
    dataSource: null,
    attribution: null,
    license: null
  };
}

/** Hasta MAX_RESULTS candidatos válidos y distintos (por tipo+id, o por coordenadas si no hay id). */
export function toCandidates(body: unknown): GeocodeCandidate[] {
  return Array.isArray(body) ? uniqueCandidates(body.map(toCandidate)) : [];
}

export function buildSearchUrl(config: GeocoderConfig, query: string): string {
  const params = new URLSearchParams({
    q: query,
    format: 'jsonv2',
    limit: String(MAX_RESULTS + 2), // margen para descartar duplicados o resultados inválidos
    dedupe: '1',
    addressdetails: '0',
    'accept-language': config.language
  });
  return `${config.baseUrl}/search?${params.toString()}`;
}

/** Una única consulta, sin reintentos. Lanza (AbortError/TypeError) si hay timeout o fallo de red: lo trata el handler. */
export async function searchNominatim(config: GeocoderConfig, query: string, fetchImpl: typeof fetch): Promise<SearchOutcome> {
  const response = await fetchImpl(buildSearchUrl(config, query), {
    method: 'GET',
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json', 'Accept-Language': config.language },
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if (response.status === 429 || response.status === 403 || response.status === 503) {
    return { kind: 'limited', ...(await readRejection(response)) };
  }
  if (!response.ok) {
    return { kind: 'error', ...(await readRejection(response)) };
  }
  const body = await response.json().catch(() => null);
  return { kind: 'ok', results: toCandidates(body) };
}
