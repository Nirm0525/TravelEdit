import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import {
  DEFAULT_PROVIDER,
  cacheKey,
  cacheScope,
  missingApiKey,
  parseCachedCandidates,
  readGeocoderConfig,
  redactSecrets,
  type GeocodeCandidate
} from './geocoder.ts';
import { buildGeoapifyUrl, searchGeoapify, toGeoapifyCandidate, toGeoapifyCandidates } from './geoapify.ts';

const KEY = 'test_key_1234567890abcdef';
const env = (values: Record<string, string> = {}) => (name: string) => values[name];
const config = (values: Record<string, string> = {}) => readGeocoderConfig(env({ GEOAPIFY_API_KEY: KEY, ...values }))!;

const BELEM = {
  datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License', url: 'https://www.openstreetmap.org/copyright' },
  name: 'Torre de Belém',
  lon: -9.215929,
  lat: 38.691586,
  formatted: 'Torre de Belém, Avenida de Brasília, 1400-038 Lisboa, Portugal',
  address_line1: 'Torre de Belém',
  address_line2: 'Avenida de Brasília, 1400-038 Lisboa, Portugal',
  result_type: 'amenity',
  place_id: '51a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5',
  bbox: { lon1: -9.216095, lat1: 38.691411, lon2: -9.215743, lat2: 38.691794 }
};

Deno.test('el proveedor por defecto es Geoapify, con su URL, su intervalo mínimo de 1 s y un límite diario de 500', () => {
  assertEquals(DEFAULT_PROVIDER, 'geoapify');
  const c = config();
  assertEquals([c.provider, c.baseUrl, c.minIntervalMs, c.dailyLimit, c.apiKey], ['geoapify', 'https://api.geoapify.com', 1100, 500, KEY]);
});

Deno.test('GEOAPIFY_API_KEY: sin clave o con una clave inválida el proveedor queda sin configurar (no se llama a nadie)', () => {
  for (const bad of ['', '   ', 'corta', 'tiene espacios y símbolos!', 'a'.repeat(200), 'clave&otro=1']) {
    const c = readGeocoderConfig(env({ GEOAPIFY_API_KEY: bad }))!;
    assertEquals(c.apiKey, null, bad);
    assert(missingApiKey(c), bad);
  }
  assertFalse(missingApiKey(config()));
  // Nominatim no necesita clave.
  assertFalse(missingApiKey(readGeocoderConfig(env({ GEOCODER_PROVIDER: 'nominatim' }))!));
});

Deno.test('Geoapify: el intervalo mínimo de 1 s no se puede reducir por configuración, ni el límite diario superar el plan gratuito', () => {
  for (const interval of ['0', '1', '250', '999', '-5', 'abc', '999.5']) {
    assert(config({ GEOCODER_MIN_INTERVAL_MS: interval }).minIntervalMs >= 1000, interval);
  }
  assertEquals(config({ GEOCODER_MIN_INTERVAL_MS: '2500' }).minIntervalMs, 2500);
  assertEquals(config({ GEOCODER_DAILY_LIMIT: '100' }).dailyLimit, 100);
  for (const bad of ['0', '-1', '3001', '1e9', 'abc', '2.5']) assertEquals(config({ GEOCODER_DAILY_LIMIT: bad }).dailyLimit, 500, bad);
});

Deno.test('proveedores desconocidos (incluido «google») no se aceptan; Nominatim solo si se elige explícitamente', () => {
  for (const p of ['google', 'otro', 'photon', '../x']) assertEquals(readGeocoderConfig(env({ GEOCODER_PROVIDER: p, GEOAPIFY_API_KEY: KEY })), null, p);
  assertEquals(readGeocoderConfig(env({ GEOAPIFY_API_KEY: KEY }))!.provider, 'geoapify');
  assertEquals(readGeocoderConfig(env({ GEOCODER_PROVIDER: 'nominatim' }))!.provider, 'nominatim');
});

Deno.test('buildGeoapifyUrl: endpoint, texto codificado, format=json, límite acotado, idioma de 2 letras y clave SOLO como apiKey', () => {
  const url = new URL(buildGeoapifyUrl(config(), 'torre de belém & más'));
  assertEquals(url.origin + url.pathname, 'https://api.geoapify.com/v1/geocode/search');
  assertEquals(url.searchParams.get('text'), 'torre de belém & más');
  assertEquals(url.searchParams.get('format'), 'json');
  assertEquals(url.searchParams.get('limit'), '5');
  assertEquals(url.searchParams.get('lang'), 'es');
  assertEquals(url.searchParams.get('apiKey'), KEY);
  assertEquals([...url.searchParams.keys()].sort(), ['apiKey', 'format', 'lang', 'limit', 'text']);
  // Idioma regional: solo las 2 primeras letras (ISO 639-1).
  assertEquals(new URL(buildGeoapifyUrl(config({ GEOCODER_LANGUAGE: 'pt-BR' }), 'x y z')).searchParams.get('lang'), 'pt');
});

Deno.test('toGeoapifyCandidate: nombre, dirección sin repetir el nombre, coordenadas, bbox, place_id y procedencia/atribución', () => {
  assertEquals(toGeoapifyCandidate(BELEM), {
    provider: 'osm',
    geocoder: 'geoapify',
    placeId: '51a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5',
    osmType: null,
    osmId: null,
    name: 'Torre de Belém',
    address: 'Avenida de Brasília, 1400-038 Lisboa, Portugal',
    lat: 38.691586,
    lon: -9.215929,
    bbox: [38.691411, -9.216095, 38.691794, -9.215743],
    dataSource: 'openstreetmap',
    attribution: '© OpenStreetMap contributors',
    license: 'Open Database License'
  });
});

Deno.test('NO se supone que todo resultado tiene identificador OSM: sin datasource.raw queda null; con él se aprovecha', () => {
  const plain = toGeoapifyCandidate(BELEM)!;
  assertEquals([plain.osmType, plain.osmId], [null, null]);
  const withRaw = toGeoapifyCandidate({ ...BELEM, datasource: { ...BELEM.datasource, raw: { osm_type: 'W', osm_id: 24341353 } } })!;
  assertEquals([withRaw.osmType, withRaw.osmId], ['way', 24341353]);
  const half = toGeoapifyCandidate({ ...BELEM, datasource: { ...BELEM.datasource, raw: { osm_type: 'W' } } })!;
  assertEquals([half.osmType, half.osmId], [null, null]);
  const other = toGeoapifyCandidate({ ...BELEM, datasource: { sourcename: 'openaddresses', attribution: '© OpenAddresses contributors' } })!;
  assertEquals([other.dataSource, other.attribution, other.license, other.osmId], ['openaddresses', '© OpenAddresses contributors', null, null]);
});

Deno.test('campos opcionales: sin name usa address_line1 o el primer tramo de formatted; sin bbox ni place_id ni datasource', () => {
  const minimal = toGeoapifyCandidate({ lon: 2, lat: 1, formatted: 'Plaza Mayor, Madrid, España' })!;
  assertEquals([minimal.name, minimal.address, minimal.bbox, minimal.placeId, minimal.dataSource, minimal.attribution], ['Plaza Mayor', 'Madrid, España', null, null, null, null]);
  assertEquals(toGeoapifyCandidate({ lon: 2, lat: 1, address_line1: 'Calle 5', formatted: 'Calle 5, Quito' })!.name, 'Calle 5');
});

Deno.test('bbox no documentado: se acepta objeto o arreglo, en cualquier orden de esquinas; incoherente → null', () => {
  const expected = [38.691411, -9.216095, 38.691794, -9.215743];
  assertEquals(toGeoapifyCandidate(BELEM)!.bbox, expected);
  assertEquals(toGeoapifyCandidate({ ...BELEM, bbox: { lon1: -9.215743, lat1: 38.691794, lon2: -9.216095, lat2: 38.691411 } })!.bbox, expected);
  assertEquals(toGeoapifyCandidate({ ...BELEM, bbox: [-9.216095, 38.691411, -9.215743, 38.691794] })!.bbox, expected);
  for (const bad of [{ lon1: 'x', lat1: 1, lon2: 2, lat2: 3 }, [1, 2, 3], 'texto', { lon1: 0, lat1: 95, lon2: 1, lat2: 96 }, null]) {
    assertEquals(toGeoapifyCandidate({ ...BELEM, bbox: bad })!.bbox, null, JSON.stringify(bad));
  }
});

Deno.test('resultados inválidos se descartan (coordenadas fuera de rango, sin nombre, no objetos); máximo 3 y sin duplicados', () => {
  for (const bad of [{ ...BELEM, lat: 91 }, { ...BELEM, lon: 181 }, { ...BELEM, lat: 'x' }, { lon: 1, lat: 1 }, null, 'texto', []]) assertEquals(toGeoapifyCandidate(bad), null);
  const many = [BELEM, { ...BELEM }, { ...BELEM, lat: 500 }, ...[1, 2, 3, 4].map((n) => ({ ...BELEM, place_id: `p${n}` }))];
  const out = toGeoapifyCandidates({ results: many });
  assertEquals(out.map((c) => c.placeId), ['51a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5', 'p1', 'p2']);
  for (const body of [null, 'x', [], {}, { results: 'no' }, { results: [] }]) assertEquals(toGeoapifyCandidates(body), []);
});

Deno.test('texto del proveedor: se limpia (sin «<», «>» ni caracteres de control) y se recorta; nunca se interpreta como HTML', () => {
  const dirty = toGeoapifyCandidate({
    ...BELEM,
    name: '<script>alert(1)</script>Hotel\u0000 Avenida',
    datasource: { sourcename: 'x'.repeat(100), attribution: '<b>© Datos</b> ' + 'y'.repeat(400), license: 'L'.repeat(200) },
    place_id: '../../etc/passwd'
  })!;
  assert(!/[<>\u0000]/.test(dirty.name), dirty.name);
  assertEquals(dirty.placeId, null);
  assertEquals([dirty.dataSource!.length, dirty.attribution!.length, dirty.license!.length], [40, 200, 60]);
  assert(!/[<>]/.test(dirty.attribution!));
});

Deno.test('caché: lo guardado se revalida (incluida la procedencia) y los formatos antiguos siguen siendo válidos', () => {
  const stored = toGeoapifyCandidate(BELEM)!;
  assertEquals(parseCachedCandidates([stored]), [stored]);
  // Entrada guardada por una versión anterior (sin geocoder, placeId, dataSource…): se acepta como Nominatim.
  const legacy = parseCachedCandidates([{ provider: 'osm', osmType: 'way', osmId: 7, name: 'Torre', address: 'Lisboa', lat: 38.69, lon: -9.21, bbox: null }]);
  assertEquals([legacy[0]!.geocoder, legacy[0]!.placeId, legacy[0]!.dataSource], ['nominatim', null, null]);
  assertEquals(parseCachedCandidates([{ ...stored, lat: 500 }, { ...stored, provider: 'otro' }, 'x', null, { ...stored, name: '' }]), []);
});

Deno.test('searchGeoapify: una sola consulta, User-Agent propio, sin la clave en cabeceras; clasifica 429/401/402/403/503 y otros errores', async () => {
  const seen: { url: string; ua: string | null; auth: string | null }[] = [];
  const make = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
    ((input: Request | URL | string, init?: RequestInit) => {
      const h = new Headers(init?.headers);
      seen.push({ url: String(input), ua: h.get('User-Agent'), auth: h.get('Authorization') });
      return Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers }));
    }) as typeof fetch;

  const ok = await searchGeoapify(config(), 'torre de belém', make(200, { results: [BELEM] }));
  assertEquals(ok.kind === 'ok' && ok.results.length, 1);
  assertEquals(seen.length, 1);
  assert(seen[0]!.ua?.startsWith('TheTravelEdit-Admin/'));
  assertEquals(seen[0]!.auth, null);
  assert(seen[0]!.url.includes(`apiKey=${KEY}`), 'la clave va solo en la URL de la petición, como documenta Geoapify');

  const limited = await searchGeoapify(config(), 'x y z', make(429, 'Too many requests', { 'retry-after': '30' }));
  assertEquals(limited.kind === 'limited' && [limited.status, limited.retryAfterSeconds], [429, 30]);
  for (const status of [401, 402, 403, 503]) assertEquals((await searchGeoapify(config(), 'x y z', make(status))).kind, 'limited', String(status));
  for (const status of [400, 404, 500]) {
    const r = await searchGeoapify(config(), 'x y z', make(status));
    assertEquals([r.kind, r.kind !== 'ok' && r.status], ['error', status]);
  }
  assertEquals(await searchGeoapify(config(), 'x y z', make(200, 'no es json')), { kind: 'ok', results: [] });
});

Deno.test('redactSecrets: la clave nunca aparece en extractos de respuestas (tal cual, como apiKey=… o en una URL)', () => {
  assertEquals(redactSecrets(`Invalid apiKey: ${KEY}`, KEY), 'Invalid apiKey: [redacted]');
  assertEquals(redactSecrets(`GET /v1/geocode/search?text=x&apiKey=${KEY}&lang=es failed`, null), 'GET /v1/geocode/search?text=x&apiKey=[redacted]&lang=es failed');
  assertEquals(redactSecrets('sin secretos', KEY), 'sin secretos');
});

Deno.test('searchGeoapify: el cuerpo de un rechazo se registra SIN la clave aunque el proveedor la repita', async () => {
  const echo = (() => Promise.resolve(new Response(`{"error":"Invalid apiKey","apiKey":"${KEY}","url":"https://api.geoapify.com/v1/geocode/search?apiKey=${KEY}"}`, { status: 401 }))) as typeof fetch;
  const r = await searchGeoapify(config(), 'x y z', echo);
  assertEquals(r.kind, 'limited');
  if (r.kind === 'limited') {
    assert(!r.bodyHint.includes(KEY), r.bodyHint);
    assert(r.bodyHint.includes('[redacted]'));
  }
});

Deno.test('caché: el ámbito y la clave separan proveedor, endpoint e idioma, y NUNCA incluyen la clave de API', () => {
  const g = config();
  const n = readGeocoderConfig(env({ GEOCODER_PROVIDER: 'nominatim' }))!;
  assert(cacheScope(g) !== cacheScope(n));
  assert(cacheScope(g).startsWith('geoapify:') && cacheScope(g).length <= 40);
  assertEquals(cacheScope(g), cacheScope(config({ GEOAPIFY_API_KEY: 'otra_clave_distinta_123456' })), 'rotar la clave no invalida la caché');
  assert(!cacheScope(g).includes(KEY) && !cacheKey(g, 'x y z').includes(KEY));
  assert(cacheScope(g) !== cacheScope(config({ GEOCODER_BASE_URL: 'https://geo.example.test' })));
  assert(cacheKey(g, 'plaza mayor') !== cacheKey(config({ GEOCODER_LANGUAGE: 'en' }), 'plaza mayor'));
  assertEquals(cacheKey(g, 'plaza mayor'), 'v2|es|plaza mayor');
});

Deno.test('tipos: GeocodeCandidate conserva la procedencia', () => {
  const c: GeocodeCandidate = toGeoapifyCandidate(BELEM)!;
  assertEquals(c.geocoder, 'geoapify');
});
