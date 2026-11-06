import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import {
  buildSearchUrl,
  buildUserAgent,
  cacheKey,
  cacheScope,
  isPublicOsmHost,
  normalizeQuery,
  parseRetryAfter,
  parseCachedCandidates,
  readGeocoderConfig,
  searchNominatim,
  toCandidate,
  toCandidates
} from './nominatim.ts';

const env = (values: Record<string, string>) => (name: string) => values[name];
// Estas pruebas son de Nominatim: se elige explícitamente (el proveedor por defecto es Geoapify).
const nom = (values: Record<string, string> = {}) => env({ GEOCODER_PROVIDER: 'nominatim', ...values });
const config = () => readGeocoderConfig(nom())!;

const BELEM = {
  osm_type: 'way',
  osm_id: 4_391_345,
  lat: '38.6916',
  lon: '-9.2160',
  name: 'Torre de Belém',
  display_name: 'Torre de Belém, Avenida Brasília, Belém, Lisboa, 1400-038, Portugal',
  boundingbox: ['38.6912', '38.6920', '-9.2164', '-9.2156']
};

Deno.test('normalizeQuery: minúsculas, espacios y comas normalizados, sin caracteres de control', () => {
  assertEquals(normalizeQuery('  Hotel   AVENIDA,Lisboa \n'), 'hotel avenida, lisboa');
  assertEquals(normalizeQuery('Hotel Avenida , Lisboa'), 'hotel avenida, lisboa');
  assertEquals(normalizeQuery('Torre\u0000 de\tBelém,, '), 'torre de belém');
  assertEquals(normalizeQuery(',  '), '');
});

Deno.test('toCandidate: convierte coordenadas, bbox [sur,norte,oeste,este] → [sur,oeste,norte,este] y separa nombre y dirección', () => {
  assertEquals(toCandidate(BELEM), {
    provider: 'osm',
    geocoder: 'nominatim',
    placeId: null,
    osmType: 'way',
    osmId: 4_391_345,
    name: 'Torre de Belém',
    address: 'Avenida Brasília, Belém, Lisboa, 1400-038, Portugal',
    lat: 38.6916,
    lon: -9.216,
    bbox: [38.6912, -9.2164, 38.692, -9.2156],
    dataSource: null,
    attribution: null,
    license: null
  });
});

Deno.test('toCandidate: sin name usa el primer tramo de display_name; descarta coordenadas inválidas o ausentes', () => {
  assertEquals(toCandidate({ lat: '1', lon: '2', display_name: 'Plaza Mayor, Madrid' })?.name, 'Plaza Mayor');
  for (const bad of [
    { lat: '91', lon: '0', name: 'x' },
    { lat: '0', lon: '181', name: 'x' },
    { lat: 'abc', lon: '0', name: 'x' },
    { lat: '1', name: 'x' },
    { lat: '1', lon: '2' },
    null,
    'texto',
    []
  ]) {
    assertEquals(toCandidate(bad), null);
  }
});

Deno.test('toCandidate: bbox incoherente o fuera de rango → null (el mapa usará un margen propio); tipo OSM desconocido → null', () => {
  assertEquals(toCandidate({ ...BELEM, boundingbox: ['39', '38', '-9', '-8'] })?.bbox, null);
  assertEquals(toCandidate({ ...BELEM, boundingbox: ['38', '39', '-9', '200'] })?.bbox, null);
  assertEquals(toCandidate({ ...BELEM, boundingbox: ['1', '2'] })?.bbox, null);
  const odd = toCandidate({ ...BELEM, osm_type: 'planet', osm_id: -3 });
  assertEquals([odd?.osmType, odd?.osmId], [null, null]);
});

Deno.test('toCandidates: máximo 3, sin duplicados y descartando los inválidos', () => {
  const many = [BELEM, { ...BELEM }, { lat: '200', lon: '0', name: 'malo' }, ...[1, 2, 3, 4].map((n) => ({ ...BELEM, osm_id: n }))];
  const out = toCandidates(many);
  assertEquals(out.length, 3);
  assertEquals(out.map((c) => c.osmId), [4_391_345, 1, 2]);
  assertEquals(toCandidates({ error: 'x' }), []);
});

Deno.test('parseCachedCandidates: revalida lo leído de la caché', () => {
  const [stored] = toCandidates([BELEM]);
  assertEquals(parseCachedCandidates([stored]), [stored]);
  assertEquals(parseCachedCandidates([{ ...stored, lat: 500 }, { ...stored, provider: 'otro' }, 'x', null]), []);
  assertEquals(parseCachedCandidates('no es lista'), []);
});

Deno.test('readGeocoderConfig: valores por defecto, User-Agent propio y mínimo de 1 s en el servicio público', () => {
  const c = config();
  assertEquals([c.provider, c.baseUrl, c.language, c.minIntervalMs, c.timeoutMs], ['nominatim', 'https://nominatim.openstreetmap.org', 'es', 1100, 8000]);
  assertEquals([c.cacheTtlSeconds, c.emptyTtlSeconds], [30 * 86400, 24 * 3600]);
  assert(c.userAgent.startsWith('TheTravelEdit-Admin/'), c.userAgent);
  assert(!/node|deno|fetch|curl/i.test(c.userAgent));
  // El público no admite menos de 1 s aunque el secret lo pida.
  assertEquals(readGeocoderConfig(nom({ GEOCODER_MIN_INTERVAL_MS: '200' }))!.minIntervalMs, 1000);
  // Una instancia propia sí puede ir más rápido.
  assertEquals(readGeocoderConfig(nom({ GEOCODER_BASE_URL: 'https://geo.example.test/nominatim/', GEOCODER_MIN_INTERVAL_MS: '50' }))!.minIntervalMs, 50);
  assertEquals(readGeocoderConfig(nom({ GEOCODER_BASE_URL: 'https://geo.example.test/nominatim/' }))!.baseUrl, 'https://geo.example.test/nominatim');
});

Deno.test('readGeocoderConfig: URL base no https, con credenciales o inválida → null; secrets mal escritos se ignoran', () => {
  for (const base of ['http://nominatim.openstreetmap.org', 'ftp://x.test', 'https://user:pw@x.test', 'no es url']) {
    assertEquals(readGeocoderConfig(nom({ GEOCODER_BASE_URL: base })), null);
  }
  const c = readGeocoderConfig(nom({ GEOCODER_LANGUAGE: '<script>', GEOCODER_TIMEOUT_MS: 'abc', GEOCODER_CACHE_DAYS: '-4' }))!;
  assertEquals([c.language, c.timeoutMs, c.cacheTtlSeconds], ['es', 8000, 30 * 86400]);
});

Deno.test('buildUserAgent: el contacto se añade; uno propio se respeta tal cual', () => {
  assert(buildUserAgent(env({ GEOCODER_CONTACT_EMAIL: 'hola@thetravel-edit.com' })).includes('contact: hola@thetravel-edit.com'));
  assertEquals(buildUserAgent(env({ GEOCODER_USER_AGENT: 'Mi-App/2 (+https://x.test)', GEOCODER_CONTACT_EMAIL: 'a@b.c' })), 'Mi-App/2 (+https://x.test)');
});

Deno.test('buildSearchUrl: formato jsonv2, límite acotado, idioma y consulta codificada (sin autocompletar ni addressdetails)', () => {
  const url = new URL(buildSearchUrl(config(), 'torre de belém & más'));
  assertEquals(url.origin + url.pathname, 'https://nominatim.openstreetmap.org/search');
  assertEquals(url.searchParams.get('q'), 'torre de belém & más');
  assertEquals(url.searchParams.get('format'), 'jsonv2');
  assertEquals(url.searchParams.get('accept-language'), 'es');
  assertEquals(url.searchParams.get('limit'), '5');
});

Deno.test('searchNominatim: envía User-Agent propio y una sola consulta; clasifica 429/403/503 y otros errores', async () => {
  const seen: { url: string; ua: string | null }[] = [];
  const make = (status: number, body: unknown = [], headers: Record<string, string> = {}) =>
    ((input: Request | URL | string, init?: RequestInit) => {
      seen.push({ url: String(input), ua: new Headers(init?.headers).get('User-Agent') });
      return Promise.resolve(new Response(JSON.stringify(body), { status, headers }));
    }) as typeof fetch;

  const ok = await searchNominatim(config(), 'torre de belém', make(200, [BELEM]));
  assertEquals(ok.kind, 'ok');
  assertEquals(seen.length, 1);
  assert(seen[0]!.ua?.startsWith('TheTravelEdit-Admin/'));

  const limited = await searchNominatim(config(), 'x y z', make(429, {}, { 'retry-after': '90' }));
  assertEquals(limited.kind, 'limited');
  assertEquals(limited.kind === 'limited' && [limited.status, limited.retryAfterSeconds, limited.retryAfterHeader], [429, 90, '90']);
  assertEquals((await searchNominatim(config(), 'x y z', make(403))).kind, 'limited');
  assertEquals((await searchNominatim(config(), 'x y z', make(503))).kind, 'limited');
  const failed = await searchNominatim(config(), 'x y z', make(500));
  assertEquals([failed.kind, failed.kind !== 'ok' && failed.status], ['error', 500]);
  const garbage = await searchNominatim(config(), 'x y z', (() => Promise.resolve(new Response('<html>', { status: 200 }))) as typeof fetch);
  assertEquals(garbage, { kind: 'ok', results: [] });
});

Deno.test('el mínimo de 1 s del Nominatim público no se evita con variantes de la URL (mayúsculas, punto final, puerto, ruta, subdominio)', () => {
  for (const base of [
    'https://nominatim.openstreetmap.org',
    'https://NOMINATIM.OpenStreetMap.org',
    'https://nominatim.openstreetmap.org.',
    'https://nominatim.openstreetmap.org:443/',
    'https://nominatim.openstreetmap.org/sub/ruta',
    'https://otro.openstreetmap.org'
  ]) {
    for (const interval of ['0', '1', '250', '999', '-5', 'abc', '999.5', '1e2', '0x10']) {
      const c = readGeocoderConfig(nom({ GEOCODER_BASE_URL: base, GEOCODER_MIN_INTERVAL_MS: interval }))!;
      assert(c.minIntervalMs >= 1000, `${base} con ${interval} → ${c.minIntervalMs}`);
    }
  }
  assertEquals(readGeocoderConfig(nom({ GEOCODER_MIN_INTERVAL_MS: '2500' }))!.minIntervalMs, 2500);
  assertEquals([isPublicOsmHost('nominatim.openstreetmap.org.'), isPublicOsmHost('evil-openstreetmap.org'), isPublicOsmHost('openstreetmap.org.evil.com')], [true, false, false]);
});

Deno.test('GEOCODER_PROVIDER con caracteres raros o demasiado largo → configuración inválida', () => {
  for (const provider of ['nomi natim', 'a'.repeat(21), '../x', 'nominatim;drop']) {
    assertEquals(readGeocoderConfig(nom({ GEOCODER_PROVIDER: provider })), null);
  }
});

Deno.test('ámbito y clave de caché: cambiar proveedor, endpoint o idioma da claves distintas; la misma configuración, la misma', () => {
  const base = readGeocoderConfig(nom({}))!;
  const scope = cacheScope(base);
  assert(scope.length <= 40 && scope.startsWith('nominatim:'), scope);
  assertEquals(cacheScope(readGeocoderConfig(nom({}))!), scope);
  assertNotEquals(cacheScope(readGeocoderConfig(nom({ GEOCODER_BASE_URL: 'https://geo.example.test' }))!), scope);
  assertNotEquals(cacheScope(readGeocoderConfig(nom({ GEOCODER_BASE_URL: 'https://geo.example.test/otra' }))!), cacheScope(readGeocoderConfig(nom({ GEOCODER_BASE_URL: 'https://geo.example.test' }))!));
  assertNotEquals(cacheScope(readGeocoderConfig(nom({ GEOCODER_PROVIDER: 'geoapify', GEOAPIFY_API_KEY: 'k'.repeat(16) }))!), scope);
  assertEquals(cacheKey(base, 'plaza mayor'), 'v2|es|plaza mayor');
  assertNotEquals(cacheKey(readGeocoderConfig(nom({ GEOCODER_LANGUAGE: 'en' }))!, 'plaza mayor'), cacheKey(base, 'plaza mayor'));
});

Deno.test('parseRetryAfter: segundos, fecha HTTP, ausente o inválido; nunca negativo', () => {
  const now = Date.parse('2026-11-03T12:00:00Z');
  assertEquals(parseRetryAfter('5', now), 5);
  assertEquals(parseRetryAfter(' 120 ', now), 120);
  assertEquals(parseRetryAfter('Tue, 03 Nov 2026 12:01:30 GMT', now), 90);
  for (const bad of [null, '', '0', '-5', 'abc', '1.5', 'Mon, 02 Nov 2026 12:00:00 GMT']) assertEquals(parseRetryAfter(bad as string | null, now), null, String(bad));
});

Deno.test('searchNominatim: una respuesta rechazada trae el estado real, Retry-After crudo y un extracto de su mensaje', async () => {
  const respond = (status: number, text: string, headers: Record<string, string> = {}) => (() => Promise.resolve(new Response(text, { status, headers }))) as typeof fetch;
  const blocked = await searchNominatim(config(), 'x y z', respond(403, 'You have been blocked\n  because of    abuse. ' + 'x'.repeat(400)));
  assertEquals(blocked.kind, 'limited');
  if (blocked.kind === 'limited') {
    assertEquals([blocked.status, blocked.retryAfterSeconds, blocked.retryAfterHeader], [403, null, null]);
    assert(blocked.bodyHint.startsWith('You have been blocked because of abuse.') && blocked.bodyHint.length <= 200);
  }
  const dated = await searchNominatim(config(), 'x y z', respond(429, '', { 'retry-after': 'Tue, 03 Nov 2099 12:00:00 GMT' }));
  assert(dated.kind === 'limited' && dated.retryAfterSeconds! > 1_000_000 && dated.retryAfterHeader === 'Tue, 03 Nov 2099 12:00:00 GMT');
});
