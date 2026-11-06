// Adaptador Geoapify (https://apidocs.geoapify.com/docs/geocoding/forward-geocoding/). Lógica pura y la llamada HTTP.
//
// Contrato (documentación oficial): GET https://api.geoapify.com/v1/geocode/search con `text`, `lang` (ISO 639-1, 2 letras), `limit`,
// `format=json` y `apiKey` (SOLO por parámetro de URL: no hay cabecera documentada). La respuesta trae `results[]` con lon, lat, formatted,
// address_line1/2, place_id, result_type, datasource {sourcename, attribution, license, url}; «algunos campos pueden faltar»: todo se trata
// como opcional. El bbox y los códigos de error NO están documentados: se lee el bbox de forma defensiva y los errores se clasifican por
// estado HTTP. El identificador OSM NO está garantizado: solo se guarda si el proveedor lo informa.
//
// La clave de API solo existe en la URL de la petición: nunca se registra (la URL no se registra, los extractos de las respuestas se
// redactan y los errores de red se registran solo por su nombre), nunca se devuelve al navegador y nunca se guarda en documentos.
import {
  MAX_RESULTS,
  maxResultsFor,
  isRecord,
  optionalPlace,
  plainText,
  readRejection,
  round6,
  toNumber,
  uniqueCandidates,
  validBbox,
  type GeocodeCandidate,
  type GeocoderConfig,
  type OsmType,
  type SearchOutcome,
  type SearchRequest
} from './geocoder.ts';

const OSM_TYPE_BY_LETTER: Record<string, OsmType> = { n: 'node', w: 'way', r: 'relation', node: 'node', way: 'way', relation: 'relation' };

/**
 * bbox de Geoapify: no está documentado; en la práctica es {lon1, lat1, lon2, lat2}. Se acepta también un array [lon1, lat1, lon2, lat2] y
 * se ordenan las esquinas, así que el orden concreto no importa; si no es coherente se descarta (el mapa usará un margen propio).
 */
function readBbox(value: unknown): GeocodeCandidate['bbox'] {
  let a: (number | null)[] | null = null;
  if (isRecord(value)) {
    a = [toNumber(value.lon1), toNumber(value.lat1), toNumber(value.lon2), toNumber(value.lat2)];
  } else if (Array.isArray(value) && value.length === 4) {
    a = value.map(toNumber);
  }
  if (!a || a.some((n) => n === null)) {
    return null;
  }
  const [lon1, lat1, lon2, lat2] = a as number[];
  return validBbox(Math.min(lat1!, lat2!), Math.min(lon1!, lon2!), Math.max(lat1!, lat2!), Math.max(lon1!, lon2!));
}

/** Convierte un elemento de `results[]`; null si no sirve (sin coordenadas válidas o sin nombre). */
export function toGeoapifyCandidate(item: unknown): GeocodeCandidate | null {
  if (!isRecord(item)) {
    return null;
  }
  const lat = toNumber(item.lat);
  const lon = toNumber(item.lon);
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  const formatted = plainText(item.formatted, 300) ?? '';
  const name = plainText(item.name, 200) ?? plainText(item.address_line1, 200) ?? plainText(formatted.split(',')[0], 200);
  if (!name) {
    return null;
  }
  // Dirección: lo formateado sin repetir el nombre al principio.
  const address = formatted.startsWith(`${name},`) ? formatted.slice(name.length + 1).trim() : formatted;

  const source = isRecord(item.datasource) ? item.datasource : {};
  // Identificador OSM: solo si viene (datasource.raw), nunca se supone.
  const raw = isRecord(source.raw) ? source.raw : {};
  const osmType = typeof raw.osm_type === 'string' ? (OSM_TYPE_BY_LETTER[raw.osm_type.toLowerCase()] ?? null) : null;
  const rawId = toNumber(raw.osm_id);
  const osmId = rawId !== null && Number.isSafeInteger(rawId) && rawId > 0 ? rawId : null;
  const placeId = typeof item.place_id === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(item.place_id) ? item.place_id : null;

  return {
    provider: 'osm',
    geocoder: 'geoapify',
    placeId,
    osmType: osmType && osmId ? osmType : null,
    osmId: osmType && osmId ? osmId : null,
    name,
    address: address.slice(0, 300),
    lat: round6(lat),
    lon: round6(lon),
    bbox: readBbox(item.bbox),
    dataSource: plainText(source.sourcename, 40),
    attribution: plainText(source.attribution, 200),
    license: plainText(source.license, 60),
    ...optionalPlace({
      city: item.city ?? item.town ?? item.village ?? item.municipality,
      country: item.country
    })
  };
}

/** Hasta `max` candidatos válidos y distintos de una respuesta `format=json` (3 en búsqueda completa, 5 en autocompletado). */
export function toGeoapifyCandidates(body: unknown, max: number = MAX_RESULTS): GeocodeCandidate[] {
  const results = isRecord(body) && Array.isArray(body.results) ? body.results : [];
  return uniqueCandidates(results.map(toGeoapifyCandidate), max);
}

const asRequest = (request: SearchRequest | string): SearchRequest => (typeof request === 'string' ? { mode: 'search', query: request, bias: null } : request);

/**
 * URL de la petición. Contiene la clave: NO se registra nunca.
 * Búsqueda completa: /v1/geocode/search. Autocompletado: /v1/geocode/autocomplete (endpoint oficial; devuelve coordenadas, así que
 * elegir una sugerencia NO requiere otra llamada) con `bias=proximity:lon,lat` como preferencia (nunca un filtro: no limita por país).
 */
export function buildGeoapifyUrl(config: GeocoderConfig, request: SearchRequest | string): string {
  const req = asRequest(request);
  const autocomplete = req.mode === 'autocomplete';
  const params = new URLSearchParams({
    text: req.query,
    format: 'json',
    limit: String(maxResultsFor(req.mode) + 2) // margen para descartar duplicados o resultados inválidos
  });
  const lang = config.language.slice(0, 2);
  if (/^[a-z]{2}$/.test(lang)) {
    params.set('lang', lang);
  }
  if (autocomplete && req.bias) {
    params.set('bias', `proximity:${req.bias.lon},${req.bias.lat}`);
  }
  params.set('apiKey', config.apiKey ?? '');
  return `${config.baseUrl}/v1/geocode/${autocomplete ? 'autocomplete' : 'search'}?${params.toString()}`;
}

/**
 * Una única consulta, sin reintentos. Lanza (AbortError/TypeError) si hay timeout o fallo de red: lo trata el handler.
 * 429 = límite; 401/402/403 = clave, plan o acceso rechazados (hay que dejar de llamar un rato: cada intento cuenta en el límite diario);
 * 503 = no disponible. Otros errores se informan tal cual.
 */
export async function searchGeoapify(config: GeocoderConfig, request: SearchRequest | string, fetchImpl: typeof fetch): Promise<SearchOutcome> {
  const req = asRequest(request);
  const response = await fetchImpl(buildGeoapifyUrl(config, req), {
    method: 'GET',
    headers: { 'User-Agent': config.userAgent, Accept: 'application/json' },
    signal: AbortSignal.timeout(config.timeoutMs)
  });
  if ([401, 402, 403, 429, 503].includes(response.status)) {
    return { kind: 'limited', ...(await readRejection(response, config.apiKey)) };
  }
  if (!response.ok) {
    return { kind: 'error', ...(await readRejection(response, config.apiKey)) };
  }
  const body = await response.json().catch(() => null);
  return { kind: 'ok', results: toGeoapifyCandidates(body, maxResultsFor(req.mode)) };
}
