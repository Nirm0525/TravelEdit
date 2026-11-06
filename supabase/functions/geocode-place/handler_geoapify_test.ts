import { assert, assertEquals } from 'jsr:@std/assert@1';
import { handleRequest, resetInflight, type Deps } from './handler.ts';
import { FakeDb } from './fake_db.ts';

const KEY = 'test_key_1234567890abcdef';
const BELEM = {
  datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License' },
  name: 'Torre de Belém',
  lon: -9.215929,
  lat: 38.691586,
  formatted: 'Torre de Belém, Avenida de Brasília, 1400-038 Lisboa, Portugal',
  place_id: 'abc123',
  bbox: { lon1: -9.216095, lat1: 38.691411, lon2: -9.215743, lat2: 38.691794 }
};
const body = (n = 4) => JSON.stringify({ results: Array.from({ length: n }, (_, i) => ({ ...BELEM, place_id: `p${i}`, name: `Lugar ${i}` })) });

const ENV: Record<string, string> = { GEOAPIFY_API_KEY: KEY, GEOCODER_BASE_URL: 'https://geo.example.test', GEOCODER_MIN_INTERVAL_MS: '60' };

function makeDeps(options: { db?: FakeDb; env?: Record<string, string>; fetch?: typeof fetch } = {}) {
  const db = options.db ?? new FakeDb();
  const fetchCalls: { url: string; at: number }[] = [];
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
      fetchCalls.push({ url: String(input), at: Date.now() });
      return (options.fetch ?? (() => Promise.resolve(new Response(body()))))(input, init);
    }) as typeof fetch,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: (message, meta) => logs.push(`${message} ${JSON.stringify(meta ?? {})}`)
  };
  return { deps, db, fetchCalls, logs };
}

const call = async (deps: Deps, query: unknown) => {
  const res = await handleRequest(
    new Request('https://x.test/geocode-place', { method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json', Origin: 'http://localhost:4301' }, body: JSON.stringify({ query }) }),
    deps
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text), headers: res.headers };
};
const fresh = () => resetInflight();

Deno.test('Geoapify: devuelve hasta 3 candidatos con su procedencia, sin identificador OSM inventado, y consume 1 llamada del límite diario', async () => {
  fresh();
  const t = makeDeps();
  const r = await call(t.deps, 'Torre de BELÉM, Lisboa');
  assertEquals([r.status, r.body.success, r.body.results.length, r.body.cached], [200, true, 3, false]);
  const c = r.body.results[0];
  assertEquals([c.geocoder, c.placeId, c.osmId, c.osmType, c.dataSource, c.attribution], ['geoapify', 'p0', null, null, 'openstreetmap', '© OpenStreetMap contributors']);
  assertEquals(r.body.attribution, '© OpenStreetMap contributors');
  assertEquals(t.fetchCalls.length, 1);
  const url = new URL(t.fetchCalls[0]!.url);
  assertEquals([url.hostname, url.pathname, url.searchParams.get('text')], ['geo.example.test', '/v1/geocode/search', 'torre de belém, lisboa']);
  assertEquals([...t.db.usage.values()], [1]);
});

Deno.test('sin GEOAPIFY_API_KEY (o inválida): provider_not_configured, NINGUNA llamada, ningún consumo y sin registrar la clave', async () => {
  for (const key of [undefined, '', 'corta', 'con espacios!!!']) {
    fresh();
    const t = makeDeps({ env: { GEOAPIFY_API_KEY: key as string } });
    const r = await call(t.deps, 'torre de belém');
    assertEquals([r.status, r.body.error, t.fetchCalls.length, t.db.usage.size], [503, 'provider_not_configured', 0, 0], String(key));
    assert(t.logs.every((l) => !l.includes('con espacios')), 'el valor de la clave no se registra');
  }
});

Deno.test('la clave NUNCA aparece en la respuesta al navegador, en los logs ni en la caché, ni siquiera en errores del proveedor', async () => {
  fresh();
  const echo = () => Promise.resolve(new Response(`{"message":"Invalid apiKey ${KEY}"}`, { status: 401 }));
  const t = makeDeps({ fetch: echo as typeof fetch });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error], [502, 'provider_blocked']);
  assert(!r.text.includes(KEY), 'respuesta');
  assert(t.logs.every((l) => !l.includes(KEY)), t.logs.join('\n'));
  assert(JSON.stringify([...t.db.rows.entries()]).indexOf(KEY) < 0, 'caché');

  fresh();
  const ok = makeDeps();
  const good = await call(ok.deps, 'otra consulta');
  assert(!good.text.includes(KEY));
  assert(ok.logs.every((l) => !l.includes(KEY)));
  assert(JSON.stringify([...ok.db.rows.entries()]).indexOf(KEY) < 0);
});

Deno.test('los aciertos de caché NO consumen llamadas; las búsquedas nuevas sí', async () => {
  fresh();
  const t = makeDeps();
  await call(t.deps, 'plaza mayor, madrid');
  for (let i = 0; i < 5; i++) {
    fresh();
    const r = await call(makeDeps({ db: t.db }).deps, 'Plaza   MAYOR,Madrid');
    assertEquals([r.status, r.body.cached], [200, true]);
  }
  assertEquals([...t.db.usage.values()], [1]);
  fresh();
  await call(makeDeps({ db: t.db }).deps, 'otra consulta distinta');
  assertEquals([...t.db.usage.values()], [2]);
});

Deno.test('cada INTENTO externo cuenta, incluidos errores, rechazos, timeouts y fallos de red', async () => {
  const attempts: (typeof fetch)[] = [
    (() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch,
    (() => Promise.reject(new TypeError('red'))) as typeof fetch,
    (() => Promise.reject(new DOMException('t', 'TimeoutError'))) as typeof fetch,
    (() => Promise.resolve(new Response('', { status: 429 }))) as typeof fetch
  ];
  const db = new FakeDb();
  for (const [i, f] of attempts.entries()) {
    fresh();
    db.nextSlot = 0;
    await call(makeDeps({ db, fetch: f }).deps, `consulta fallida ${i}`);
  }
  assertEquals([...db.usage.values()], [4]);
});

Deno.test('límite diario: al agotarse NO se llama al proveedor, se sirve lo cacheado y las búsquedas nuevas reciben quota_exhausted con su renovación', async () => {
  fresh();
  const db = new FakeDb();
  const env = { GEOCODER_DAILY_LIMIT: '3' };
  for (let i = 0; i < 3; i++) {
    fresh();
    const r = await call(makeDeps({ db, env }).deps, `consulta ${i}`);
    assertEquals(r.status, 200, `consulta ${i}`);
  }
  assertEquals([...db.usage.values()], [3]);

  fresh();
  const blocked = makeDeps({ db, env });
  const r = await call(blocked.deps, 'consulta nueva sin cache');
  assertEquals([r.status, r.body.error, r.body.dailyLimit, r.body.retryAfterSeconds, blocked.fetchCalls.length], [429, 'quota_exhausted', 3, 3600, 0]);
  assertEquals(r.headers.get('Retry-After'), '3600');
  assertEquals([...db.usage.values()], [3], 'rechazar no consume');
  assertEquals(db.queryRowCount, 3, 'no queda reserva de la consulta rechazada');

  // Lo ya buscado sigue disponible.
  fresh();
  const cached = makeDeps({ db, env });
  const hit = await call(cached.deps, 'consulta 1');
  assertEquals([hit.status, hit.body.cached, cached.fetchCalls.length], [200, true, 0]);
});

Deno.test('concurrencia: 40 búsquedas nuevas simultáneas con límite 10 → exactamente 10 llamadas al proveedor, el resto quota_exhausted', async () => {
  fresh();
  const db = new FakeDb();
  const env = { GEOCODER_DAILY_LIMIT: '10', GEOCODER_MIN_INTERVAL_MS: '1000' };
  const instances = Array.from({ length: 8 }, () => makeDeps({ db, env: { ...env, GEOCODER_MIN_INTERVAL_MS: '1000' } }));
  // El turno de 1 s haría esperar a todas; se anula para medir el límite (el intervalo ya está probado aparte).
  db.reserveSlot = () => Promise.resolve(0);
  for (const i of instances) i.deps.reserveSlot = db.reserveSlot;
  const results = await Promise.all(Array.from({ length: 40 }, (_, k) => call(instances[k % 8]!.deps, `lugar número ${k}`)));
  const calls = instances.reduce((n, i) => n + i.fetchCalls.length, 0);
  assertEquals(calls, 10);
  assertEquals(results.filter((r) => r.status === 200).length, 10);
  assertEquals(results.filter((r) => r.body.error === 'quota_exhausted').length, 30);
  assertEquals([...db.usage.values()], [10]);
});

Deno.test('429 del proveedor: se respeta su Retry-After y NO se consulta mientras dure la pausa (tampoco se gasta cuota)', async () => {
  fresh();
  const db = new FakeDb();
  const limited = makeDeps({ db, fetch: (() => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '45' } }))) as typeof fetch });
  const first = await call(limited.deps, 'torre de belém');
  assertEquals([first.status, first.body.error, first.body.retryAfterSeconds, first.body.retryAfterSource], [429, 'provider_limited', 45, 'provider']);
  assertEquals([...db.usage.values()], [1]);
  fresh();
  const during = makeDeps({ db });
  const second = await call(during.deps, 'otra consulta');
  assertEquals([second.status, second.body.error, during.fetchCalls.length], [429, 'provider_limited', 0]);
  assertEquals([...db.usage.values()], [1], 'durante la pausa no se consume cuota');
});

Deno.test('401 (clave rechazada): provider_blocked con pausa por defecto de 600 s y sin afirmar la causa', async () => {
  fresh();
  const t = makeDeps({ fetch: (() => Promise.resolve(new Response('{"error":"Unauthorized"}', { status: 401 }))) as typeof fetch });
  const r = await call(t.deps, 'torre de belém');
  assertEquals([r.status, r.body.error, r.body.providerStatus, r.body.retryAfterSeconds, r.body.retryAfterSource], [502, 'provider_blocked', 401, 600, 'default']);
});

Deno.test('ritmo conservador: Geoapify nunca baja de 1 petición por segundo aunque la configuración lo pida', async () => {
  fresh();
  const db = new FakeDb();
  const env = { GEOCODER_MIN_INTERVAL_MS: '1' };
  // Con la URL base por defecto del proveedor (sin GEOCODER_BASE_URL de pruebas) el suelo de 1000 ms aplica igualmente.
  const instance = (e = env) => makeDeps({ db, env: { GEOCODER_BASE_URL: undefined as unknown as string, ...e } });
  const a = instance();
  const seen: number[] = [];
  const origReserve = db.reserveSlot;
  db.reserveSlot = (p: string, interval: number, max: number) => {
    seen.push(interval);
    return origReserve(p, interval, max);
  };
  a.deps.reserveSlot = db.reserveSlot;
  await call(a.deps, 'consulta uno');
  assert(seen.every((i) => i >= 1000), `intervalos pedidos a la base: ${seen}`);
});

Deno.test('no hay respaldo: con Geoapify configurado NUNCA se llama a Nominatim, ni en errores ni al agotar el límite', async () => {
  fresh();
  const db = new FakeDb();
  const urls: string[] = [];
  const failing = ((input: Request | URL | string) => {
    urls.push(String(input));
    return Promise.resolve(new Response('', { status: 429 }));
  }) as typeof fetch;
  for (let i = 0; i < 3; i++) {
    fresh();
    db.nextSlot = 0;
    await call(makeDeps({ db, fetch: failing, env: { GEOCODER_DAILY_LIMIT: '1' } }).deps, `consulta ${i}`);
  }
  assert(urls.length >= 1 && urls.every((u) => new URL(u).hostname === 'geo.example.test' && !u.includes('nominatim')), urls.join('\n'));
});
