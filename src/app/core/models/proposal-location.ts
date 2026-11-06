// Ubicación opcional (con mapa) de un día o de un servicio. Espejo de projects/admin/src/app/core/models/proposal-location.ts (sin el análisis del HTML pegado, que solo hace el admin)
// (apps separadas que no comparten código): la validación del mapa debe ser idéntica en ambos lados.
//
// Solo se admite el formato de «Compartir → Insertar un mapa» de Google Maps: https://www.google.com/maps/embed?pb=…
// Las rutas /maps/embed/v1/* de la Embed API exigen una API key (no se usa en esta versión y no queremos guardar claves
// en el contenido), así que se rechazan. Nunca se guarda el HTML pegado: solo la URL ya validada y normalizada.

export interface ProposalMapLocation {
  name: string;
  address?: string;
  /** Código de Google Maps pegado a mano: URL de inserción YA validada (validateEmbedUrl). Los mapas anteriores siguen así. */
  embedUrl?: string;
  /** Lugar elegido con «Buscar ubicación» (OpenStreetMap). Excluyente con embedUrl: si hay lugar, manda el lugar. */
  place?: ProposalPlace;
}

export type OsmType = 'node' | 'way' | 'relation';
export type PlaceGeocoder = 'geoapify' | 'nominatim';

/**
 * Lugar elegido en la búsqueda (Nominatim / OpenStreetMap): datos estructurados, NUNCA una URL. El mapa se construye en código
 * (osmEmbedUrl) a partir de estas coordenadas, y se vuelve a validar al guardar y al mostrar.
 */
export interface ProposalPlace {
  provider: 'osm';
  lat: number;
  lon: number;
  /** [sur, oeste, norte, este] en grados; ausente = se usa un margen alrededor del punto. */
  bbox?: [number, number, number, number];
  osmType?: OsmType;
  osmId?: number;
  /**
   * Quién geocodificó el lugar (determina la atribución obligatoria que se muestra junto al mapa). Ausente en lugares guardados antes de
   * este campo. NO se supone que todo lugar tenga identificador OSM: osmType/osmId solo existen si el proveedor los informó.
   */
  geocoder?: PlaceGeocoder;
  /** Identificador del lugar en el geocodificador (p. ej. place_id de Geoapify). */
  placeId?: string;
  /** Procedencia de los datos según el proveedor (p. ej. «openstreetmap»), su atribución y su licencia: texto plano, nunca HTML. */
  dataSource?: string;
  attribution?: string;
  license?: string;
}

const OSM_ORIGIN = 'https://www.openstreetmap.org';
const OSM_EMBED_PATH = '/export/embed.html';
/** Mitad del lado mínimo del recuadro del mapa (≈ 220 m) y margen por defecto alrededor de un punto (≈ 440 m). */
const MIN_HALF_SPAN = 0.002;
const DEFAULT_HALF_SPAN = 0.004;
const BBOX_TOLERANCE = 1e-6;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Texto plano del proveedor: sin caracteres de control ni «<»/«>», recortado; undefined si queda vacío. Nunca se interpreta como HTML. */
function plainText(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return text || undefined;
}
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Valida un lugar (al guardar y al leer del contenido). Devuelve solo campos conocidos o undefined si el proveedor no es
 * 'osm' o las coordenadas no son válidas. Un bbox incoherente (desordenado, fuera de rango o sin contener el punto) se
 * descarta, no invalida el lugar.
 */
export function toSafePlace(value: unknown): ProposalPlace | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const lat = raw['lat'];
  const lon = raw['lon'];
  if (raw['provider'] !== 'osm' || !isNum(lat) || !isNum(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return undefined;
  }
  const place: ProposalPlace = { provider: 'osm', lat: round6(lat), lon: round6(lon) };
  const box = raw['bbox'];
  if (Array.isArray(box) && box.length === 4 && box.every(isNum)) {
    const [s, w, n, e] = box as [number, number, number, number];
    const ordered = s <= n && w <= e && s >= -90 && n <= 90 && w >= -180 && e <= 180;
    const contains = lat >= s - BBOX_TOLERANCE && lat <= n + BBOX_TOLERANCE && lon >= w - BBOX_TOLERANCE && lon <= e + BBOX_TOLERANCE;
    if (ordered && contains) {
      place.bbox = [round6(s), round6(w), round6(n), round6(e)];
    }
  }
  const type = raw['osmType'];
  if (type === 'node' || type === 'way' || type === 'relation') {
    place.osmType = type;
  }
  const id = raw['osmId'];
  if (isNum(id) && Number.isSafeInteger(id) && id > 0) {
    place.osmId = id;
  }
  const geocoder = raw['geocoder'];
  if (geocoder === 'geoapify' || geocoder === 'nominatim') {
    place.geocoder = geocoder;
  }
  const placeId = raw['placeId'];
  if (typeof placeId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(placeId)) {
    place.placeId = placeId;
  }
  const dataSource = plainText(raw['dataSource'], 40);
  if (dataSource) {
    place.dataSource = dataSource;
  }
  const attribution = plainText(raw['attribution'], 200);
  if (attribution) {
    place.attribution = attribution;
  }
  const license = plainText(raw['license'], 60);
  if (license) {
    place.license = license;
  }
  return place;
}

/** Recuadro (sur, oeste, norte, este) del mapa: el del lugar con un tamaño mínimo, o un margen alrededor del punto. */
function mapBounds(place: ProposalPlace): [number, number, number, number] {
  let [s, w, n, e] = place.bbox ?? [place.lat - DEFAULT_HALF_SPAN, place.lon - DEFAULT_HALF_SPAN, place.lat + DEFAULT_HALF_SPAN, place.lon + DEFAULT_HALF_SPAN];
  if (n - s < 2 * MIN_HALF_SPAN) {
    const mid = (n + s) / 2;
    s = mid - MIN_HALF_SPAN;
    n = mid + MIN_HALF_SPAN;
  }
  if (e - w < 2 * MIN_HALF_SPAN) {
    const mid = (e + w) / 2;
    w = mid - MIN_HALF_SPAN;
    e = mid + MIN_HALF_SPAN;
  }
  return [Math.max(-90, s), Math.max(-180, w), Math.min(90, n), Math.min(180, e)].map(round6) as [number, number, number, number];
}

/** URL de inserción de OpenStreetMap construida en código con un lugar YA validado; null si el lugar no es válido. */
export function osmEmbedUrl(value: unknown): string | null {
  const place = toSafePlace(value);
  if (!place) {
    return null;
  }
  const [s, w, n, e] = mapBounds(place);
  const url = new URL(OSM_EMBED_PATH, OSM_ORIGIN);
  url.searchParams.set('bbox', [w, s, e, n].join(','));
  url.searchParams.set('layer', 'mapnik');
  url.searchParams.set('marker', `${place.lat},${place.lon}`);
  return url.toString();
}

/** «Abrir en OpenStreetMap»: enlace oficial con el marcador en las coordenadas del lugar. */
export function osmOpenUrl(value: unknown): string | null {
  const place = toSafePlace(value);
  if (!place) {
    return null;
  }
  const url = new URL('/', OSM_ORIGIN);
  url.searchParams.set('mlat', String(place.lat));
  url.searchParams.set('mlon', String(place.lon));
  url.hash = `map=17/${place.lat}/${place.lon}`;
  return url.toString();
}

export const OSM_COPYRIGHT_URL = `${OSM_ORIGIN}/copyright`;
export const GEOAPIFY_URL = 'https://www.geoapify.com/';

/**
 * Atribuciones que se muestran junto al mapa de un lugar buscado. La de OpenStreetMap siempre (el mapa es de OSM). Si lo geocodificó
 * Geoapify, además «Powered by Geoapify» (obligatoria en su plan gratuito); el texto de otra fuente de datos solo si el proveedor
 * informó una distinta de OpenStreetMap.
 */
export function placeCredits(value: unknown): { geoapify: boolean; dataAttribution: string | null } {
  const place = toSafePlace(value);
  const other = place?.attribution && !/openstreetmap/i.test(place.attribution) ? place.attribution : null;
  return { geoapify: place?.geocoder === 'geoapify', dataAttribution: other };
}

const EMBED_HOST = 'www.google.com';
const EMBED_PATH = '/maps/embed';
/** Caracteres que usa el parámetro `pb` de Google (ya codificado). Nada que permita salir del parámetro. */
const PB_PATTERN = /^[A-Za-z0-9!%._~:;,=+*-]{1,4000}$/;

export const MAX_NAME_LENGTH = 200;
export const MAX_ADDRESS_LENGTH = 300;

/**
 * Devuelve la URL de inserción normalizada (`https://www.google.com/maps/embed?pb=…`) o null si no cumple TODO:
 * HTTPS, hostname exacto, sin credenciales ni puerto, ruta exacta y un único `pb` bien formado. Se reconstruye la
 * URL: cualquier otro parámetro o fragmento se descarta.
 */
export function validateEmbedUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== 'https:' ||
    url.hostname !== EMBED_HOST ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== EMBED_PATH
  ) {
    return null;
  }
  const pbParts = url.search
    .replace(/^\?/, '')
    .split('&')
    .filter((part) => part.startsWith('pb='));
  if (pbParts.length !== 1) {
    return null;
  }
  const pb = pbParts[0]?.slice(3) ?? '';
  return PB_PATTERN.test(pb) ? `https://${EMBED_HOST}${EMBED_PATH}?pb=${pb}` : null;
}

/**
 * Normaliza lo escrito por el asesor. Sin nombre no hay ubicación (undefined); nunca se guarda un objeto vacío. El lugar
 * buscado (place) y el código de Google pegado (embedUrl) son excluyentes: si hay un lugar válido, manda el lugar.
 */
export function normalizeMapLocation(
  name: string,
  address: string,
  embedUrl: string | null,
  place?: ProposalPlace | null
): ProposalMapLocation | undefined {
  const cleanName = name.trim();
  if (!cleanName) {
    return undefined;
  }
  const location: ProposalMapLocation = { name: cleanName };
  const cleanAddress = address.trim();
  if (cleanAddress) {
    location.address = cleanAddress;
  }
  const safePlace = toSafePlace(place);
  if (safePlace) {
    location.place = safePlace;
  } else if (embedUrl) {
    location.embedUrl = embedUrl;
  }
  return location;
}

/**
 * Valida una ubicación LEÍDA del contenido antes de renderizarla (puede venir de documentos antiguos o editados fuera
 * del builder). Devuelve solo campos conocidos; un mapa inválido se descarta pero se conservan nombre y dirección.
 * Los mapas de Google guardados antes (embedUrl) siguen siendo válidos.
 */
export function toSafeMapLocation(value: unknown): ProposalMapLocation | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const raw = value as Record<string, unknown>;
  const name = typeof raw['name'] === 'string' ? raw['name'].trim().slice(0, MAX_NAME_LENGTH) : '';
  if (!name) {
    return undefined;
  }
  const address = typeof raw['address'] === 'string' ? raw['address'].trim().slice(0, MAX_ADDRESS_LENGTH) : '';
  const place = toSafePlace(raw['place']);
  const embedUrl = place ? null : validateEmbedUrl(raw['embedUrl']);
  return normalizeMapLocation(name, address, embedUrl, place);
}

/**
 * «Abrir en Google Maps»: URL oficial de búsqueda. Con un lugar elegido usa sus coordenadas (más precisas); si no, el nombre
 * y la dirección codificados (sin deducir coordenadas).
 */
export function googleMapsSearchUrl(location: Pick<ProposalMapLocation, 'name' | 'address'> & { place?: unknown }): string {
  const place = toSafePlace(location.place);
  const query = place ? `${place.lat},${place.lon}` : [location.name, location.address].filter((part) => part?.trim()).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}
