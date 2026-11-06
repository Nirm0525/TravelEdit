// Autocompletado (mode: 'autocomplete') de geocode-place. El proveedor es SIEMPRE simulado: estas pruebas NO demuestran nada sobre la
// respuesta real de Geoapify (su forma exacta se comprobará con la clave real).
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { handleRequest, resetInflight, type Deps } from './handler.ts';
import { FakeDb } from './fake_db.ts';
import { cacheKey, readGeocoderConfig } from './geocoder.ts';
import { buildGeoapifyUrl } from './geoapify.ts';

const KEY = 'test_key_1234567890abcdef';
const item = (i: number) => ({
  datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License' },
  name: `Hotel ${i}`,
  lon: -9.2 + i / 100,
  lat: 38.7 + i / 100,
  formatted: `Hotel ${i}, Rua ${i}, Lisboa, Portugal`,
  city: 'Lisboa',
  country: 'Portugal',
  place_id: `p${i}`
});
const body = (n = 8) => JSON.stringify({ results: Array.from({ length: n }, (_, i) => item(i)) });
const ENV: Record<string, string> = { GEOAPIFY_API_KEY: KEY, GEOCODER_BASE_URL: 'https://geo.example.test', GEOCODER_MIN_INTERVAL_MS: '60' };

function makeDeps(options: { db?: FakeDb; env?: Record<string, string | undefined>; fetch?: typeof fetch } = {}) {
  const db = options.db ?? new FakeDb();
  const fetchCalls: string[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    env: (name) => ({ ...ENV, ...options.env })[name],
    authenticate: () => Promise.resolve({ id: 'u1' }),
    canManageProposals: () => Promise.resolve(true),
    claim: db.claim,
    store: db.store,
    release: db.release,
    reserveSlot: db.reserveSlot,
    backoff: db.backoff,
    quota: db.quota,
    fetch: ((input: Request | URL | string, init?: RequestInit) => {
      fetchCalls.push(String(input));
      return (options.fetch ?? (() => Promise.resolve(new Response(body()))))(input, init);
    }) as typeof fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (message, meta) => logs.push(`${message} ${JSON.stringify(meta ?? {})}`)
  };
  return { deps, db, fetchCalls, logs };
}

const call = async (deps: Deps, payload: Record<string, unknown>, headers: Record<string, string> = {}) => {
  const res = await handleRequest(
    new Request('https://x.test/geocode-place', {
      method: 'POST',
      headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json', Origin: 'http://localhost:4301', ...headers },
      body: JSON.stringify(payload)
    }),
    deps
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
};
const suggest = (deps: Deps, query: unknown, extra: Record<string, unknown> = {}) => call(deps, { query, mode: 'autocomplete', ...extra });
const fresh = () => resetInflight();

Deno.test('autocompletado: usa el endpoint oficial /autocomplete, devuelve hasta 5 sugerencias con ciudad y país, y consume 1 llamada', async () => {
  fresh();
  const t = makeDeps();
  const r = await suggest(t.deps, 'Hotel Avenida Lisboa');
  assertEquals([r.status, r.body.success, r.body.results.length, r.body.cached], [200, true, 5, false]);
  assertEquals([r.body.results[0].name, r.body.results[0].city, r.body.results[0].country, r.body.results[0].geocoder], ['Hotel 0', 'Lisboa', 'Portugal', 'geoapify']);
  const url = new URL(t.fetchCalls[0]!);
  assertEquals([url.hostname, url.pathname, url.searchParams.get('text'), url.searchParams.get('limit')], ['geo.example.test', '/v1/geocode/autocomplete', 'hotel avenida lisboa', '7']);
  assertEquals(url.searchParams.get('bias'), null, 'sin preferencia no se envía bias');
  assert(!url.searchParams.has('filter'), 'no se limita por país');
  assertEquals([...t.db.usage.values()], [1]);
});

Deno.test('autocompletado: exige 4 caracteres en el servidor (la búsqueda completa sigue admitiendo 3) y valida el modo', async () => {
  fresh();
  const t = makeDeps();
  assertEquals((await suggest(t.deps, 'hot')).body.error, 'invalid_query');
  assertEquals((await suggest(t.deps, '  ab  ')).body.error, 'invalid_query');
  assertEquals((await call(t.deps, { query: 'abc', mode: 'otro' })).body.error, 'invalid_mode');
  assertEquals(t.fetchCalls.length, 0);
  assertEquals(t.db.usage.size, 0);
  fresh();
  const search = await call(t.deps, { query: 'abc' });
  assertEquals([search.status, new URL(t.fetchCalls[0]!).pathname], [200, '/v1/geocode/search']);
});

Deno.test('la caché distingue autocompletado y búsqueda completa: la misma consulta NO comparte entradas y cada una consume su llamada', async () => {
  fresh();
  const t = makeDeps();
  await suggest(t.deps, 'plaza mayor madrid');
  fresh();
  const search = await call(makeDeps({ db: t.db }).deps, { query: 'plaza mayor madrid' });
  assertEquals([search.body.cached, search.body.results.length], [false, 3]);
  assertEquals([...t.db.usage.values()], [2]);
  assertEquals(t.db.queryRowCount, 2);
  // Repetir cada una → acierto de caché, sin consumo.
  fresh();
  const again = makeDeps({ db: t.db });
  const hitSuggest = await suggest(again.deps, 'Plaza  Mayor Madrid');
  fresh();
  const hitSearch = await call(again.deps, { query: 'plaza mayor madrid' });
  assertEquals([hitSuggest.body.cached, hitSuggest.body.results.length, hitSearch.body.cached, hitSearch.body.results.length], [true, 5, true, 3]);
  assertEquals([again.fetchCalls.length, ...t.db.usage.values()], [0, 2]);
});

Deno.test('la clave de caché incluye endpoint, límite, idioma y preferencia geográfica', () => {
  const es = readGeocoderConfig((n) => ({ GEOAPIFY_API_KEY: KEY }[n]))!;
  const en = readGeocoderConfig((n) => ({ GEOAPIFY_API_KEY: KEY, GEOCODER_LANGUAGE: 'en' }[n]))!;
  const q = 'hotel avenida';
  assertEquals(cacheKey(es, q), 'v2|es|hotel avenida', 'la búsqueda completa no cambia');
  assertEquals(cacheKey(es, q, { mode: 'autocomplete' }), 'v3|ac5|es|prox:none|hotel avenida');
  assertEquals(cacheKey(es, q, { mode: 'autocomplete', bias: { lat: 38.7, lon: -9.1 } }), 'v3|ac5|es|prox:38.7,-9.1|hotel avenida');
  assertNotEquals(cacheKey(es, q, { mode: 'autocomplete' }), cacheKey(es, q));
  assertNotEquals(cacheKey(es, q, { mode: 'autocomplete' }), cacheKey(en, q, { mode: 'autocomplete' }));
  assertNotEquals(cacheKey(es, q, { mode: 'autocomplete', bias: { lat: 38.7, lon: -9.1 } }), cacheKey(es, q, { mode: 'autocomplete', bias: { lat: 40.4, lon: -3.7 } }));
});

Deno.test('preferencia geográfica: se envía como proximidad (no filtro), se redondea y consultas cercanas comparten caché; una inválida se ignora', async () => {
  fresh();
  const t = makeDeps();
  const a = await suggest(t.deps, 'hotel avenida', { bias: { lat: 38.7139, lon: -9.1394 } });
  assertEquals(a.status, 200);
  assertEquals(new URL(t.fetchCalls[0]!).searchParams.get('bias'), 'proximity:-9.1,38.7');
  fresh();
  const near = makeDeps({ db: t.db });
  const b = await suggest(near.deps, 'hotel avenida', { bias: { lat: 38.6991, lon: -9.1499 } });
  assertEquals([b.body.cached, near.fetchCalls.length], [true, 0]);
  // Otra ciudad (Madrid) → otra entrada.
  fresh();
  const far = makeDeps({ db: t.db });
  const c = await suggest(far.deps, 'hotel avenida', { bias: { lat: 40.4168, lon: -3.7038 } });
  assertEquals([c.body.cached, far.fetchCalls.length], [false, 1]);
  assertEquals(new URL(far.fetchCalls[0]!).searchParams.get('bias'), 'proximity:-3.7,40.4');
  // Inválida (fuera de rango o no numérica) → como sin preferencia, nunca error ni coordenadas inventadas.
  for (const bias of [{ lat: 999, lon: 0 }, { lat: 'x', lon: 1 }, 'cerca', null]) {
    fresh();
    const inv = makeDeps();
    const r = await suggest(inv.deps, 'hotel avenida', { bias });
    assertEquals(r.status, 200);
    assertEquals(new URL(inv.fetchCalls[0]!).searchParams.get('bias'), null);
  }
});

Deno.test('cuota compartida: autocompletado, búsqueda completa y repeticiones suman en el MISMO contador; al agotarse no se llama a nadie', async () => {
  fresh();
  const db = new FakeDb();
  const env = { GEOCODER_DAILY_LIMIT: '3' };
  const t = (extra?: Partial<Parameters<typeof makeDeps>[0]>) => makeDeps({ db, env, ...extra });
  assertEquals((await suggest(t().deps, 'consulta uno')).status, 200);
  fresh();
  assertEquals((await call(t().deps, { query: 'consulta dos' })).status, 200);
  fresh();
  assertEquals((await suggest(t().deps, 'consulta tres')).status, 200);
  assertEquals([...db.usage.values()], [3]);
  fresh();
  const blocked = t();
  const r = await suggest(blocked.deps, 'consulta cuatro');
  assertEquals([r.status, r.body.error, blocked.fetchCalls.length], [429, 'quota_exhausted', 0]);
  fresh();
  const blockedSearch = await call(blocked.deps, { query: 'consulta cinco' });
  assertEquals([blockedSearch.body.error, blocked.fetchCalls.length], ['quota_exhausted', 0]);
  // Lo cacheado sigue sirviéndose con la cuota agotada, tanto en sugerencias como en búsqueda explícita.
  fresh();
  const hit = await suggest(t().deps, 'consulta uno');
  fresh();
  const hit2 = await call(t().deps, { query: 'consulta dos' });
  assertEquals([hit.body.cached, hit2.body.cached, [...db.usage.values()][0]], [true, true, 3]);
});

Deno.test('pausa del proveedor: el autocompletado recibe la misma pausa (sin llamar ni gastar cuota) y lo cacheado sigue disponible', async () => {
  fresh();
  const db = new FakeDb();
  await suggest(makeDeps({ db }).deps, 'consulta guardada');
  fresh();
  const limited = makeDeps({ db, fetch: (() => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '90' } }))) as typeof fetch });
  db.nextSlot = 0;
  const first = await suggest(limited.deps, 'consulta que falla');
  assertEquals([first.status, first.body.error, first.body.retryAfterSeconds], [429, 'provider_limited', 90]);
  const used = [...db.usage.values()][0];
  fresh();
  const during = makeDeps({ db });
  const second = await suggest(during.deps, 'otra consulta nueva');
  assertEquals([second.body.error, during.fetchCalls.length, [...db.usage.values()][0]], ['provider_limited', 0, used]);
  fresh();
  const cached = await suggest(makeDeps({ db }).deps, 'consulta guardada');
  assertEquals([cached.status, cached.body.cached], [200, true]);
});

Deno.test('Nominatim NO ofrece autocompletado (su política lo prohíbe) y la clave de Geoapify nunca sale en sugerencias', async () => {
  fresh();
  const nom = makeDeps({ env: { GEOCODER_PROVIDER: 'nominatim', GEOCODER_BASE_URL: 'https://nominatim.example.test' } });
  const r = await suggest(nom.deps, 'hotel avenida');
  assertEquals([r.status, r.body.error, nom.fetchCalls.length], [400, 'autocomplete_unsupported', 0]);

  fresh();
  const echo = makeDeps({ fetch: (() => Promise.resolve(new Response(`{"message":"Invalid apiKey ${KEY}"}`, { status: 401 }))) as typeof fetch });
  const bad = await suggest(echo.deps, 'hotel avenida');
  assert(!bad.text.includes(KEY));
  assert(echo.logs.every((l) => !l.includes(KEY)));
  assert(JSON.stringify([...echo.db.rows.entries()]).indexOf(KEY) < 0);
  assert(echo.logs.every((l) => !l.includes('hotel avenida')), 'el texto buscado no se registra');
});

Deno.test('sin clave: el autocompletado no llama a nadie ni consume cuota; con JWT inválido o sin permiso se rechaza', async () => {
  fresh();
  const t = makeDeps({ env: { GEOAPIFY_API_KEY: undefined } });
  const r = await suggest(t.deps, 'hotel avenida');
  assertEquals([r.status, r.body.error, t.fetchCalls.length, t.db.usage.size], [503, 'provider_not_configured', 0, 0]);

  fresh();
  const denied = makeDeps();
  denied.deps.canManageProposals = () => Promise.resolve(false);
  assertEquals((await suggest(denied.deps, 'hotel avenida')).status, 403);
  denied.deps.authenticate = () => Promise.resolve(null);
  assertEquals((await suggest(denied.deps, 'hotel avenida')).status, 401);
  const noToken = await call(denied.deps, { query: 'hotel avenida', mode: 'autocomplete' }, { Authorization: '' });
  assertEquals(noToken.status, 401);
  assertEquals([denied.fetchCalls.length, denied.db.usage.size], [0, 0]);
});

Deno.test('autocompletado: una consulta idéntica simultánea comparte una sola llamada al proveedor', async () => {
  fresh();
  const t = makeDeps();
  const results = await Promise.all(Array.from({ length: 6 }, () => suggest(t.deps, 'hotel avenida lisboa')));
  assertEquals(results.filter((r) => r.status === 200).length, 6);
  assertEquals([t.fetchCalls.length, ...t.db.usage.values()], [1, 1]);
});

Deno.test('buildGeoapifyUrl: la clave solo va en la URL de la petición y el autocompletado no añade filtros por país', () => {
  const config = readGeocoderConfig((n) => ({ GEOAPIFY_API_KEY: KEY }[n]))!;
  const url = new URL(buildGeoapifyUrl(config, { mode: 'autocomplete', query: 'hotel', bias: { lat: 38.7, lon: -9.1 } }));
  assertEquals([url.pathname, url.searchParams.get('lang'), url.searchParams.get('bias'), url.searchParams.has('filter'), url.searchParams.get('apiKey')], [
    '/v1/geocode/autocomplete',
    'es',
    'proximity:-9.1,38.7',
    false,
    KEY
  ]);
});
