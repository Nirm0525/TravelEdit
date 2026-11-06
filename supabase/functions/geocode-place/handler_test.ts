import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handleRequest, resetInflight, type Deps } from './handler.ts';
import { FakeDb } from './fake_db.ts';

const BELEM = {
  osm_type: 'way',
  osm_id: 4_391_345,
  lat: '38.6916',
  lon: '-9.2160',
  name: 'Torre de Belém',
  display_name: 'Torre de Belém, Avenida Brasília, Lisboa, Portugal',
  boundingbox: ['38.6912', '38.6920', '-9.2164', '-9.2156']
};

interface Options {
  db?: FakeDb;
  env?: Record<string, string>;
  user?: { id: string } | null;
  canManage?: boolean;
  fetch?: typeof fetch;
}

// Estas pruebas simulan Nominatim (el proveedor por defecto de producción es Geoapify: ver handler_geoapify_test.ts).
const ENV: Record<string, string> = { GEOCODER_PROVIDER: 'nominatim', GEOCODER_BASE_URL: 'https://geo.example.test', GEOCODER_MIN_INTERVAL_MS: '60' };

function makeDeps(options: Options = {}) {
  const db = options.db ?? new FakeDb();
  const fetchCalls: { url: string; at: number; ua: string | null }[] = [];
  const logs: string[] = [];
  const deps: Deps = {
    env: (name) => ({ ...ENV, ...options.env })[name],
    authenticate: () => Promise.resolve(options.user === undefined ? { id: 'u1' } : options.user),
    canManageProposals: () => Promise.resolve(options.canManage ?? true),
    claim: db.claim,
    store: db.store,
    release: db.release,
    reserveSlot: db.reserveSlot,
    backoff: db.backoff,
    quota: db.quota,
    fetch: ((input: Request | URL | string, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), at: Date.now(), ua: new Headers(init?.headers).get('User-Agent') });
      return (options.fetch ?? (() => Promise.resolve(new Response(JSON.stringify([BELEM, { ...BELEM, osm_id: 2 }, { ...BELEM, osm_id: 3 }, { ...BELEM, osm_id: 4 }])))))(input, init);
    }) as typeof fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (message, meta) => logs.push(`${message} ${JSON.stringify(meta ?? {})}`)
  };
  return { deps, db, fetchCalls, logs };
}

const request = (body: unknown, headers: Record<string, string> = { Authorization: 'Bearer jwt', Origin: 'http://localhost:4301' }, method = 'POST') =>
  new Request('https://x.test/geocode-place', { method, headers: { 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });

const call = async (deps: Deps, query: unknown, headers?: Record<string, string>) => {
  const res = await handleRequest(request({ query }, headers), deps);
  return { status: res.status, body: await res.json(), headers: res.headers };
};

const fresh = () => resetInflight();

Deno.test('sin Authorization → 401; sesión inválida → 401; sin permiso para gestionar propuestas → 403; nada llega a la base ni al proveedor', async () => {
  fresh();
  const a = makeDeps();
  assertEquals((await call(a.deps, 'torre de belém', { Origin: 'http://localhost:4301' })).status, 401);
  const b = makeDeps({ user: null });
  assertEquals((await call(b.deps, 'torre de belém')).status, 401);
  const c = makeDeps({ canManage: false });
  const denied = await call(c.deps, 'torre de belém');
  assertEquals([denied.status, denied.body.error], [403, 'forbidden']);
  for (const t of [a, b, c]) {
    assertEquals(t.fetchCalls.length, 0);
    assertEquals(t.db.queryRowCount, 0);
  }
});

Deno.test('consulta inválida (corta, vacía, no texto, demasiado larga) → 400 sin llegar al proveedor', async () => {
  fresh();
  const t = makeDeps();
  for (const q of ['ab', '   ', 42, null, 'x'.repeat(250)]) {
    const r = await call(t.deps, q);
    assertEquals(r.status, 400, String(q).slice(0, 10));
  }
  assertEquals(t.fetchCalls.length, 0);
});

Deno.test('devuelve hasta 3 candidatos con atribución, identifica la aplicación y no usa el texto crudo', async () => {
  fresh();
  const t = makeDeps();
  const r = await call(t.deps, '  Torre de BELÉM,Lisboa ');
  assertEquals(r.status, 200);
  assertEquals(r.body.success, true);
  assertEquals(r.body.results.length, 3);
  assertEquals(r.body.cached, false);
  assertEquals(r.body.attribution, '© OpenStreetMap contributors');
  assertEquals(r.body.results[0].name, 'Torre de Belém');
  assertEquals(r.headers.get('Cache-Control'), 'private, no-store');
  assertEquals(t.fetchCalls.length, 1);
  assert(t.fetchCalls[0]!.ua?.startsWith('TheTravelEdit-Admin/'));
  assertEquals(new URL(t.fetchCalls[0]!.url).searchParams.get('q'), 'torre de belém, lisboa');
  assert(t.logs.every((l) => !/belém|lisboa/i.test(l)), 'los logs no llevan el texto buscado');
});

Deno.test('caché: la segunda consulta equivalente (otra grafía) no va al proveedor y marca cached', async () => {
  fresh();
  const t = makeDeps();
  await call(t.deps, 'Torre de Belém, Lisboa');
  const again = await call(t.deps, 'torre de   belém,Lisboa');
  assertEquals([again.status, again.body.cached, again.body.results.length], [200, true, 3]);
  assertEquals(t.fetchCalls.length, 1);
  assertEquals(t.db.stores[0]!.ttl, 30 * 86400);
});

Deno.test('sin resultados: devuelve lista vacía, la cachea con TTL corto y la repetición no consulta de nuevo', async () => {
  fresh();
  const t = makeDeps({ fetch: () => Promise.resolve(new Response('[]')) });
  const r = await call(t.deps, 'lugar que no existe zzz');
  assertEquals([r.status, r.body.success, r.body.results], [200, true, []]);
  assertEquals(t.db.stores[0], { key: 'v2|es|lugar que no existe zzz', count: 0, ttl: 24 * 3600 });
  await call(t.deps, 'lugar que no existe zzz');
  assertEquals(t.fetchCalls.length, 1);
});

Deno.test('429 del proveedor: responde provider_limited con Retry-After, pausa global, no cachea y no reintenta', async () => {
  fresh();
  const t = makeDeps({ fetch: () => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '45' } })) });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.retryAfterSeconds, r.headers.get('Retry-After')], [429, 'provider_limited', 45, '45']);
  assertEquals(t.fetchCalls.length, 1);
  assertEquals(t.db.backoffs, [45]);
  assertEquals(t.db.queryRowCount, 0);
  assertEquals(t.db.releases, 1);

  // Mientras dura la pausa global ninguna instancia consulta: responde con lo que falta de la pausa del proveedor, sin tocarlo.
  fresh();
  const next = makeDeps({ db: t.db });
  const paused = await call(next.deps, 'otra consulta distinta');
  assertEquals([paused.status, paused.body.error, paused.body.providerStatus, paused.body.retryAfterSource], [429, 'provider_limited', 429, 'provider']);
  assert(paused.body.retryAfterSeconds > 40 && paused.body.retryAfterSeconds <= 45, String(paused.body.retryAfterSeconds));
  assertEquals(next.fetchCalls.length, 0);
});

Deno.test('errores del proveedor: 500 → 502, fallo de red → 502, timeout → 504; ninguno se cachea y todos liberan la reserva', async () => {
  const cases: [string, () => Promise<Response>, number, string][] = [
    ['http 500', () => Promise.resolve(new Response('', { status: 500 })), 502, 'provider_unavailable'],
    ['red', () => Promise.reject(new TypeError('network')), 502, 'provider_unavailable'],
    ['timeout', () => Promise.reject(new DOMException('t', 'TimeoutError')), 504, 'timeout'],
    ['abort', () => Promise.reject(new DOMException('t', 'AbortError')), 504, 'timeout'],
    ['otro', () => Promise.reject(new Error('raro')), 500, 'unexpected_error']
  ];
  for (const [label, fetchImpl, status, error] of cases) {
    fresh();
    const t = makeDeps({ fetch: fetchImpl });
    const r = await call(t.deps, 'torre de belém');
    assertEquals([r.status, r.body.error], [status, error], label);
    assertEquals(t.db.queryRowCount, 0, label);
    assertEquals(t.db.releases, 1, label);
    assertEquals(t.db.stores.length, 0, label);
  }
});

Deno.test('turno global agotado (espera > máximo) → «ocupado» sin consultar al proveedor y sin dejar reserva', async () => {
  fresh();
  const db = new FakeDb();
  db.nextSlot = Date.now() + 60_000;
  const t = makeDeps({ db });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error], [429, 'busy']);
  assertEquals(t.fetchCalls.length, 0);
  assertEquals(db.queryRowCount, 0);
});

Deno.test('proveedor no configurado o URL base insegura → 503 con error controlado', async () => {
  for (const env of [{ GEOCODER_PROVIDER: 'google' } as Record<string, string>, { GEOCODER_BASE_URL: 'http://nominatim.openstreetmap.org' }]) {
    fresh();
    const t = makeDeps({ env });
    const r = await call(t.deps, 'torre de belém');
    assertEquals([r.status, r.body.error], [503, 'provider_not_configured']);
    assertEquals(t.fetchCalls.length, 0);
  }
});

Deno.test('CORS: preflight 204 solo con origen permitido; método distinto de POST → 405', async () => {
  fresh();
  const t = makeDeps();
  const ok = await handleRequest(request(null, { Origin: 'http://localhost:4301' }, 'OPTIONS'), t.deps);
  assertEquals([ok.status, ok.headers.get('Access-Control-Allow-Origin')], [204, 'http://localhost:4301']);
  const evil = await handleRequest(request(null, { Origin: 'https://evil.test' }, 'OPTIONS'), t.deps);
  assertEquals(evil.headers.get('Access-Control-Allow-Origin'), null);
  assertEquals((await handleRequest(request(null, undefined, 'GET'), t.deps)).status, 405);
});

Deno.test('concurrencia: 8 consultas idénticas simultáneas en una instancia → UNA sola consulta al proveedor', async () => {
  fresh();
  const t = makeDeps();
  const results = await Promise.all(Array.from({ length: 8 }, () => call(t.deps, 'torre de belém, lisboa')));
  assert(results.every((r) => r.status === 200 && r.body.results.length === 3));
  assertEquals(t.fetchCalls.length, 1);
});

Deno.test('concurrencia entre instancias: la segunda espera el resultado de la primera y no consulta al proveedor', async () => {
  fresh();
  const db = new FakeDb();
  const slow = makeDeps({
    db,
    fetch: () => new Promise((resolve) => setTimeout(() => resolve(new Response(JSON.stringify([BELEM]))), 120))
  });
  const other = makeDeps({ db });
  const first = call(slow.deps, 'torre de belém, lisboa');
  await new Promise((r) => setTimeout(r, 20));
  resetInflight(); // otra instancia = otro proceso: no comparte el mapa en memoria
  const second = call(other.deps, 'torre de belém, lisboa');
  const [a, b] = await Promise.all([first, second]);
  assertEquals([a.status, b.status], [200, 200]);
  assertEquals([a.body.cached, b.body.cached], [false, true]);
  assertEquals(slow.fetchCalls.length + other.fetchCalls.length, 1);
});

Deno.test('límite global: consultas distintas simultáneas desde varias instancias salen al proveedor espaciadas por el intervalo', async () => {
  fresh();
  const db = new FakeDb();
  const instances = [makeDeps({ db }), makeDeps({ db }), makeDeps({ db })];
  const queries = ['plaza mayor madrid', 'sagrada familia barcelona', 'alhambra granada', 'giralda sevilla', 'prado madrid', 'park güell barcelona'];
  const responses = await Promise.all(queries.map((q, i) => call(instances[i % 3]!.deps, q)));
  assert(responses.every((r) => r.status === 200), JSON.stringify(responses.map((r) => r.body.error)));

  const times = instances.flatMap((i) => i.fetchCalls.map((c) => c.at)).sort((a, b) => a - b);
  assertEquals(times.length, 6);
  for (let i = 1; i < times.length; i++) {
    assert(times[i]! - times[i - 1]! >= 40, `huecos (intervalo 60 ms; tolerancia por el temporizador del sistema) entre consultas: ${times.map((t) => t - times[0]!).join(', ')}`);
  }
});

const limitedBy = (status: number, headers: Record<string, string> = {}, text = '') => makeDeps({ fetch: () => Promise.resolve(new Response(text, { status, headers })) });

Deno.test('429 con Retry-After: se respeta TAL CUAL (sin suelo), se marca como pedido por el proveedor y se informa su estado real', async () => {
  fresh();
  const t = limitedBy(429, { 'retry-after': '7' });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.retryAfterSeconds, r.body.retryAfterSource, r.body.providerStatus, r.headers.get('Retry-After')], [429, 'provider_limited', 7, 'provider', 429, '7']);
  assertEquals(t.db.backoffs, [7]);
});

Deno.test('429 sin Retry-After: pausa por defecto de 120 s, marcada como «default» (no como si la pidiera el proveedor)', async () => {
  fresh();
  const t = limitedBy(429);
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.body.error, r.body.retryAfterSeconds, r.body.retryAfterSource, r.body.providerStatus], ['provider_limited', 120, 'default', 429]);
  assertEquals(t.db.backoffs, [120]);
});

Deno.test('Retry-After como fecha HTTP se convierte en segundos', async () => {
  fresh();
  const soon = limitedBy(429, { 'retry-after': new Date(Date.now() + 40_000).toUTCString() });
  const a = await call(soon.deps, 'torre de belém');
  assert(a.body.retryAfterSeconds >= 38 && a.body.retryAfterSeconds <= 41, String(a.body.retryAfterSeconds));
});

Deno.test('403 del proveedor: «bloqueado» (sin afirmar la causa), con su estado real y pausa por defecto de 300 s', async () => {
  fresh();
  const t = limitedBy(403, {}, 'Access blocked: bad user agent');
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.providerStatus, r.body.retryAfterSeconds, r.body.retryAfterSource], [502, 'provider_blocked', 403, 300, 'default']);
  assertEquals(t.db.backoffs, [300]);
  assertEquals(t.db.queryRowCount, 0);
});

Deno.test('503 del proveedor: no disponible, con su estado real; respeta Retry-After si lo envía y pausa 60 s si no', async () => {
  fresh();
  const none = limitedBy(503);
  const a = await call(none.deps, 'torre de belém');
  assertEquals([a.status, a.body.error, a.body.providerStatus, a.body.retryAfterSeconds], [502, 'provider_unavailable', 503, 60]);
  fresh();
  const dated = limitedBy(503, { 'retry-after': '15' });
  assertEquals((await call(dated.deps, 'torre de belém')).body.retryAfterSeconds, 15);
});

Deno.test('500 del proveedor: provider_unavailable con su estado, sin pausa global', async () => {
  fresh();
  const t = limitedBy(500);
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.providerStatus, r.body.retryAfterSeconds], [502, 'provider_unavailable', 500, undefined]);
  assertEquals(t.db.backoffs, []);
});

Deno.test('el log registra estado, Retry-After, extracto del mensaje y User-Agent del proveedor, pero nunca la consulta', async () => {
  fresh();
  const t = limitedBy(429, { 'retry-after': '30' }, 'Too many requests from your IP');
  await call(t.deps, 'consulta secreta de un cliente');
  const line = t.logs.find((l) => l.startsWith('geocode.provider'))!;
  assert(line.includes('"status":429') && line.includes('"retryAfter":"30"') && line.includes('Too many requests from your IP') && line.includes('TheTravelEdit-Admin/'), line);
  assert(t.logs.every((l) => !/consulta secreta|cliente/i.test(l)));
});

Deno.test('espera interna (turno agotado) es «busy» con espera corta y SIN estado de proveedor', async () => {
  fresh();
  const db = new FakeDb();
  db.nextSlot = Date.now() + 60_000;
  const t = makeDeps({ db });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.providerStatus, r.body.retryAfterSource], [429, 'busy', undefined, undefined]);
  assert(r.body.retryAfterSeconds <= 5);
});

Deno.test('Retry-After > 3600 s: se conserva la espera COMPLETA (marcador de pausa) y no se vuelve a consultar al cumplirse una hora', async () => {
  fresh();
  const first = limitedBy(429, { 'retry-after': '7200' });
  const r = await call(first.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.retryAfterSeconds, r.body.retryAfterSource, r.headers.get('Retry-After')], [429, 'provider_limited', 7200, 'provider', '7200']);
  assertEquals(first.db.backoffs, [3600], 'el turno de la base solo admite 1 h: la pausa completa vive en el marcador');
  const marker = first.db.pauseMarker()!;
  assertEquals(first.db.stores.at(-1)!.ttl, 7200);
  assert(Math.abs(marker.expiresAt - Date.now() - 7_200_000) < 5_000);

  // Otra consulta distinta: NO llega al proveedor y recibe lo que falta.
  fresh();
  const during = makeDeps({ db: first.db });
  const again = await call(during.deps, 'otra consulta distinta');
  assertEquals([again.status, again.body.error, again.body.providerStatus, again.body.retryAfterSource], [429, 'provider_limited', 429, 'provider']);
  assert(again.body.retryAfterSeconds > 7190 && again.body.retryAfterSeconds <= 7200, String(again.body.retryAfterSeconds));
  assertEquals(during.fetchCalls.length, 0);

  // «Pasa» 3700 s (más de una hora): sigue en pausa, sin consultar.
  const shift = (ms: number) => {
    const m = first.db.pauseMarker()!;
    (m.results as unknown as { until: number }[])[0]!.until -= ms;
    m.expiresAt -= ms;
  };
  shift(3_700_000);
  fresh();
  const afterHour = makeDeps({ db: first.db });
  const stillPaused = await call(afterHour.deps, 'otra consulta distinta');
  assertEquals([stillPaused.status, stillPaused.body.error, afterHour.fetchCalls.length], [429, 'provider_limited', 0]);
  assert(stillPaused.body.retryAfterSeconds > 3490 && stillPaused.body.retryAfterSeconds <= 3500, String(stillPaused.body.retryAfterSeconds));

  // Al cumplirse la espera completa, vuelve a consultar.
  shift(3_600_000);
  first.db.nextSlot = 0;
  fresh();
  const done = makeDeps({ db: first.db });
  const ok = await call(done.deps, 'otra consulta distinta');
  assertEquals([ok.status, ok.body.success, done.fetchCalls.length], [200, true, 1]);
});

Deno.test('la pausa del proveedor no impide servir resultados ya cacheados', async () => {
  fresh();
  const db = new FakeDb();
  const ok = makeDeps({ db });
  await call(ok.deps, 'torre de belém');
  fresh();
  const limited = makeDeps({ db, fetch: () => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '7200' } })) });
  assertEquals((await call(limited.deps, 'otra consulta distinta')).body.error, 'provider_limited');
  fresh();
  const cached = await call(makeDeps({ db }).deps, 'torre de belém');
  assertEquals([cached.status, cached.body.cached], [200, true]);
});

Deno.test('Retry-After de más de un año se acota al máximo de la caché (1 año)', async () => {
  fresh();
  const t = limitedBy(429, { 'retry-after': '999999999' });
  assertEquals((await call(t.deps, 'torre de belém')).body.retryAfterSeconds, 31_536_000);
});
