// Pruebas de INTEGRACIÓN de la migración 0057 y de geocode-place contra un PostgreSQL REAL, con varias conexiones independientes
// (cada una es un proceso de backend distinto, como las instancias de la Edge Function) y, donde importa, procesos Deno separados.
// El proveedor (Nominatim) siempre es simulado: nunca hay consultas reales.
//
// Se omiten si no hay base: definir GEOCODE_TEST_PG_URL con una base DESECHABLE (se borran y recrean los objetos geocode_*):
//   GEOCODE_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:55432/geo deno test -A supabase/functions/geocode-place/postgres_concurrency_test.ts
// Por seguridad la base debe llamarse «geo» o terminar en «_geocode_test»; si no, la prueba se niega a ejecutarse.
import { assert, assertEquals, assertNotEquals } from 'jsr:@std/assert@1';
import { fromFileUrl } from 'jsr:@std/path@1';
import { handleRequest, resetInflight, type Deps } from './handler.ts';
import { connectAs, fakeGeoapifyBody, fakeNominatimBody, pgDeps, type PgClient } from './pg_deps.ts';

const PG_URL = Deno.env.get('GEOCODE_TEST_PG_URL');
if (PG_URL && !/^(geo|.*_geocode_test)$/.test(new URL(PG_URL).pathname.slice(1))) {
  throw new Error('GEOCODE_TEST_PG_URL debe apuntar a una base desechable llamada «geo» o «*_geocode_test».');
}

const read = (path: string) => Deno.readTextFileSync(new URL(path, import.meta.url));
const MIGRATION = read('../../migrations/0057_geocode_cache.sql');
const ROLLBACK = read('../../migration-scripts/0057_geocode_cache_rollback.sql');
const VERIFY = read('../../migration-scripts/0057_geocode_cache_verify.sql');
const MIGRATION_58 = read('../../migrations/0058_geocode_daily_quota.sql');
const ROLLBACK_58 = read('../../migration-scripts/0058_geocode_daily_quota_rollback.sql');
const VERIFY_58 = read('../../migration-scripts/0058_geocode_daily_quota_verify.sql');
const CHILD = fromFileUrl(new URL('./pg_instance_child.ts', import.meta.url));

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function test(name: string, fn: (ctx: Ctx) => Promise<void>, timeoutMs = 120_000): void {
  Deno.test({
    name: `pg real: ${name}`,
    ignore: !PG_URL,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: async () => {
      const ctx = await Ctx.create();
      try {
        await Promise.race([fn(ctx), sleep(timeoutMs).then(() => Promise.reject(new Error(`la prueba superó ${timeoutMs} ms (¿algo quedó bloqueado?)`)))]);
      } finally {
        await ctx.close();
      }
    }
  });
}

class Ctx {
  private opened: PgClient[] = [];
  private constructor(readonly admin: PgClient) {}

  static async create(): Promise<Ctx> {
    const admin = await connectAs(PG_URL!, 'postgres');
    await admin.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
    end $$`);
    await admin.query('create schema if not exists private');
    await admin.query('grant usage on schema public, private to service_role, anon, authenticated');
    await admin.query(ROLLBACK_58);
    await admin.query(ROLLBACK);
    await admin.query(MIGRATION);
    await admin.query(MIGRATION_58);
    return new Ctx(admin);
  }

  async conn(role = 'service_role'): Promise<PgClient> {
    const c = await connectAs(PG_URL!, role);
    this.opened.push(c);
    return c;
  }

  conns(n: number, role = 'service_role'): Promise<PgClient[]> {
    return Promise.all(Array.from({ length: n }, () => this.conn(role)));
  }

  async close(): Promise<void> {
    // Una conexión bloqueada (si una prueba falla a mitad) no debe colgar la limpieza.
    const end = (c: PgClient) => Promise.race([c.end().catch(() => undefined), sleep(1_500)]);
    for (const c of this.opened) await end(c);
    await end(this.admin);
  }
}

type Row = Record<string, unknown>;
const rows = async (c: PgClient, sql: string, values: unknown[] = []) => (await c.query<Row>(sql, values)).rows;
const reserve = async (c: PgClient, provider: string, interval: number, maxWait: number) =>
  Number((await rows(c, 'select public.geocode_reserve_slot($1, $2, $3) as w', [provider, interval, maxWait]))[0]!.w);
const claim = async (c: PgClient, provider: string, key: string, lease = 30) =>
  (await rows(c, 'select state, results from public.geocode_claim($1, $2, $3, $4)', [provider, key, 'consulta', lease]))[0]!;
const request = async (deps: Deps, query: string) => {
  const res = await handleRequest(
    new Request('https://x.test/geocode-place', { method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }),
    deps
  );
  return { status: res.status, body: await res.json() };
};
const simulatedProvider = (log: { q: string; at: number }[]) =>
  ((input: Request | URL | string) => {
    const q = String(new URL(String(input)).searchParams.get('q'));
    log.push({ q, at: Date.now() });
    return Promise.resolve(new Response(fakeNominatimBody(q)));
  }) as typeof fetch;

// ================================================================== migración

test('la migración se aplica, pasa el verify real, es idempotente y se revierte y reaplica sin dejar nada', async (ctx) => {
  const verify = await ctx.admin.query(VERIFY);
  const checks = (Array.isArray(verify) ? verify.at(-1)! : verify).rows as { n: number; check: string; ok: boolean }[];
  assertEquals(checks.length, 6);
  for (const c of checks) assert(c.ok, `verify ${c.n}: ${c.check}`);
  const verify58 = await ctx.admin.query(VERIFY_58);
  const checks58 = (Array.isArray(verify58) ? verify58.at(-1)! : verify58).rows as { n: number; check: string; ok: boolean }[];
  assertEquals(checks58.length, 6);
  for (const c of checks58) assert(c.ok, `verify 0058 ${c.n}: ${c.check}`);
  await ctx.admin.query(MIGRATION_58); // 0058 también es idempotente

  await ctx.admin.query(MIGRATION); // idempotente
  await ctx.admin.query(ROLLBACK_58);
  await ctx.admin.query(ROLLBACK);
  const left = await rows(ctx.admin, `select (select count(*) from pg_proc where proname like 'geocode\\_%')::int as f, (select count(*) from pg_tables where tablename like 'geocode\\_%')::int as t`);
  assertEquals([left[0]!.f, left[0]!.t], [0, 0]);
  const tables = await rows(ctx.admin, `select count(*)::int as n from pg_tables where schemaname = 'private' and tablename like 'geocode\\_%'`);
  assertEquals(tables[0]!.n, 0);
  await ctx.admin.query(MIGRATION);
  await ctx.admin.query(MIGRATION_58);
});

test('permisos: anon y authenticated no pueden ejecutar las funciones ni leer las tablas', async (ctx) => {
  for (const role of ['anon', 'authenticated']) {
    const c = await ctx.conn(role);
    for (const sql of [
      `select * from public.geocode_claim('p', 'k', 'q', 30)`,
      `select public.geocode_reserve_slot('p', 1000, 4000)`,
      `select public.geocode_backoff('p', 60)`,
      `select public.geocode_cache_purge()`,
      `select * from private.geocode_cache`
    ]) {
      let denied = false;
      try {
        await c.query(sql);
      } catch (e) {
        denied = /permission denied/.test(String((e as Error).message));
      }
      assert(denied, `${role} no debería poder: ${sql}`);
    }
  }
});

test('las «instancias» son conexiones realmente independientes (backends distintos)', async (ctx) => {
  const cs = await ctx.conns(12);
  const pids = new Set((await Promise.all(cs.map((c) => rows(c, 'select pg_backend_pid() as pid')))).map((r) => r[0]!.pid));
  assertEquals(pids.size, 12);
});

// ================================================================== turno global

test('40 conexiones reservan turno a la vez: sin duplicados ni pérdidas; los turnos quedan separados EXACTAMENTE por el intervalo', async (ctx) => {
  const N = 40;
  const INTERVAL = 100;
  // El primer turno es fijo (futuro): así el reparto es verificable de forma exacta, sin depender del reloj de cada llamada.
  const cs = await ctx.conns(N);
  await ctx.admin.query(`insert into private.geocode_rate_state (provider, next_slot_at) values ('p', now() + interval '5 seconds')`);
  const s0 = new Date((await rows(ctx.admin, `select next_slot_at from private.geocode_rate_state where provider = 'p'`))[0]!.next_slot_at as Date).getTime();
  const waits = await Promise.all(cs.map((c) => reserve(c, 'p', INTERVAL, 60_000)));
  assertEquals(new Set(waits).size, N, `esperas repetidas: ${waits.sort((a, b) => a - b)}`);
  assert(waits.every((w) => w >= 0));
  const after = new Date((await rows(ctx.admin, `select next_slot_at from private.geocode_rate_state where provider = 'p'`))[0]!.next_slot_at as Date).getTime();
  assertEquals(after - s0, N * INTERVAL, 'cada reserva avanzó el turno exactamente un intervalo (ninguna se perdió ni se duplicó)');
});

test('con un máximo de espera, las reservas que no caben devuelven -1 y NO consumen turno', async (ctx) => {
  const N = 40;
  const cs = await ctx.conns(N); // primero las conexiones: abrirlas tarda, y el turno inicial debe fijarse justo antes de reservar
  await ctx.admin.query(`insert into private.geocode_rate_state (provider, next_slot_at) values ('p', now() + interval '2 seconds')`);
  const s0 = new Date((await rows(ctx.admin, `select next_slot_at from private.geocode_rate_state where provider = 'p'`))[0]!.next_slot_at as Date).getTime();
  const waits = await Promise.all(cs.map((c) => reserve(c, 'p', 100, 2_500)));
  const granted = waits.filter((w) => w >= 0);
  assert(granted.length > 3 && granted.length < N, `granted=${granted.length}`);
  assert(granted.every((w) => w <= 2_500));
  assertEquals(waits.filter((w) => w < 0).every((w) => w === -1), true);
  const after = new Date((await rows(ctx.admin, `select next_slot_at from private.geocode_rate_state where provider = 'p'`))[0]!.next_slot_at as Date).getTime();
  assertEquals(after - s0, granted.length * 100);
});

test('con el turno ya vencido (sistema inactivo) la espera es SIEMPRE 0, nunca negativa: ninguna petición legítima recibe «ocupado»', async (ctx) => {
  const c = await ctx.conn();
  const seen = new Set<number>();
  for (let i = 0; i < 300; i++) {
    await ctx.admin.query(`insert into private.geocode_rate_state (provider, next_slot_at) values ('p', now() - interval '30 seconds')
      on conflict (provider) do update set next_slot_at = excluded.next_slot_at`);
    seen.add(await reserve(c, 'p', 1100, 4_000));
  }
  assertEquals([...seen], [0], `esperas devueltas con el turno vencido: ${[...seen]}`);
});

test('el turno de un proveedor no retrasa a otro (cada endpoint tiene su propio límite)', async (ctx) => {
  const [a, b] = await ctx.conns(2);
  await ctx.admin.query(`select public.geocode_backoff('uno', 300)`);
  assertEquals(await reserve(a!, 'uno', 1000, 4000), -1);
  assert((await reserve(b!, 'dos', 1000, 4000)) <= 5);
});

// ================================================================== reclamaciones duplicadas

test('30 conexiones piden la MISMA consulta a la vez: exactamente una la reclama, las demás esperan; tras guardar todas la ven', async (ctx) => {
  const cs = await ctx.conns(30);
  const results = await Promise.all(cs.map((c) => claim(c, 'p', 'es|plaza mayor')));
  assertEquals(results.filter((r) => r.state === 'claimed').length, 1);
  assertEquals(results.filter((r) => r.state === 'wait').length, 29);
  await rows(cs[0]!, `select public.geocode_store('p', 'es|plaza mayor', '[{"name":"x"}]'::jsonb, 3600)`);
  const after = await Promise.all(cs.map((c) => claim(c, 'p', 'es|plaza mayor')));
  assert(after.every((r) => r.state === 'hit' && JSON.stringify(r.results) === '[{"name":"x"}]'));
});

test('30 consultas DISTINTAS a la vez: todas se reclaman, ninguna se pisa', async (ctx) => {
  const cs = await ctx.conns(30);
  const results = await Promise.all(cs.map((c, i) => claim(c, 'p', `k${i}`)));
  assert(results.every((r) => r.state === 'claimed'));
  assertEquals(Number((await rows(ctx.admin, 'select count(*) as n from private.geocode_cache'))[0]!.n), 30);
});

test('una entrada VENCIDA nunca se sirve como «hit», aunque haya más de 25 vencidas por limpiar', async (ctx) => {
  // 40 vencidas; la clave «objetivo» es de las MÁS recientes entre las vencidas (queda fuera de las 25 más antiguas).
  await ctx.admin.query(`insert into private.geocode_cache (provider, query_key, query_text, status, results, expires_at)
    select 'p', 'v' || g, 'x', 'ready', '[{"viejo":true}]'::jsonb, now() - (interval '1 hour') * (100 - g) from generate_series(1, 39) g`);
  await ctx.admin.query(`insert into private.geocode_cache (provider, query_key, query_text, status, results, expires_at)
    values ('p', 'objetivo', 'x', 'ready', '[{"viejo":true}]'::jsonb, now() - interval '1 second')`);
  const c = await ctx.conn();
  const r = await claim(c, 'p', 'objetivo');
  assertEquals(r.state, 'claimed', `se sirvió una entrada vencida: ${JSON.stringify(r)}`);
});

test('limpieza concurrente: 600 vencidas y 60 conexiones reclamando a la vez, sin deadlocks ni errores', async (ctx) => {
  await ctx.admin.query(`insert into private.geocode_cache (provider, query_key, query_text, status, results, expires_at)
    select 'p', 'old' || g, 'x', 'ready', '[]'::jsonb, now() - (interval '1 second') * g from generate_series(1, 600) g`);
  const cs = await ctx.conns(60);
  const outcomes = await Promise.allSettled(
    cs.map(async (c, i) => {
      const out = [];
      for (let k = 0; k < 5; k++) out.push(await claim(c, 'p', i % 2 ? `new${i}-${k}` : `old${(i * 7 + k) % 600 + 1}`));
      return out;
    })
  );
  const failures = outcomes.filter((o) => o.status === 'rejected').map((o) => String((o as PromiseRejectedResult).reason));
  assertEquals(failures, [], `errores de concurrencia (¿deadlock?): ${failures.slice(0, 3)}`);
  const states = outcomes.flatMap((o) => (o as PromiseFulfilledResult<Row[]>).value.map((r) => r.state));
  assert(states.every((s) => s === 'claimed'), `estados: ${[...new Set(states)]}`);
});

// ================================================================== vencimiento, errores e instancias interrumpidas

test('una reserva vence sola al terminar su lease; mientras dura, otras instancias esperan', async (ctx) => {
  const [a, b] = await ctx.conns(2);
  assertEquals((await claim(a!, 'p', 'k', 2)).state, 'claimed');
  assertEquals((await claim(b!, 'p', 'k', 2)).state, 'wait');
  await sleep(2_300);
  assertEquals((await claim(b!, 'p', 'k', 2)).state, 'claimed');
});

test('instancia interrumpida (conexión cortada tras reclamar): la reserva queda pendiente SOLO hasta que vence su lease', async (ctx) => {
  const [a, b] = await ctx.conns(2);
  assertEquals((await claim(a!, 'p', 'k', 3)).state, 'claimed');
  const pid = (await rows(a!, 'select pg_backend_pid() as pid'))[0]!.pid;
  await rows(ctx.admin, 'select pg_terminate_backend($1)', [pid]); // la instancia «muere»
  assertEquals((await claim(b!, 'p', 'k', 3)).state, 'wait');
  await sleep(3_300);
  assertEquals((await claim(b!, 'p', 'k', 3)).state, 'claimed');
});

test('release libera una reserva propia pero nunca borra resultados ya guardados', async (ctx) => {
  const [a] = await ctx.conns(1);
  await claim(a!, 'p', 'fallo');
  await rows(a!, `select public.geocode_release('p', 'fallo')`);
  assertEquals((await claim(a!, 'p', 'fallo')).state, 'claimed');
  await rows(a!, `select public.geocode_store('p', 'fallo', '[]'::jsonb, 3600)`);
  await rows(a!, `select public.geocode_release('p', 'fallo')`);
  assertEquals((await claim(a!, 'p', 'fallo')).state, 'hit');
});

test('un bloqueo de fila retenido sobre el turno NO deja bloqueadas a las demás instancias: devuelven «ocupado» y se recuperan al soltarse', async (ctx) => {
  const [b] = await ctx.conns(1);
  await reserve(b!, 'p', 100, 60_000); // crea la fila
  const holder = await connectAs(PG_URL!, 'postgres'); // p. ej. una instancia congelada en mitad de una transacción
  await holder.query(`begin; select * from private.geocode_rate_state where provider = 'p' for update`);
  const started = Date.now();
  const blocked = await Promise.race([reserve(b!, 'p', 100, 4_000), sleep(8_000).then(() => 'BLOQUEADO')]);
  assertEquals(blocked, -1, `la reserva quedó esperando el bloqueo ${Date.now() - started} ms`);
  assert(Date.now() - started < 4_000, `tardó demasiado en rendirse: ${Date.now() - started} ms`);

  const holderPid = (await rows(holder, 'select pg_backend_pid() as pid'))[0]!.pid;
  await rows(ctx.admin, 'select pg_terminate_backend($1)', [holderPid]); // la instancia congelada se cae: PostgreSQL suelta el bloqueo
  assert((await reserve(b!, 'p', 100, 4_000)) >= 0);
  await holder.end().catch(() => undefined);
});

test('backoff y valores absurdos tienen tope: ningún error de configuración deja el proveedor pausado «para siempre»', async (ctx) => {
  const [a] = await ctx.conns(1);
  await rows(a!, `select public.geocode_backoff('p', 2000000000)`);
  let seconds = Number((await rows(ctx.admin, `select extract(epoch from (next_slot_at - clock_timestamp())) as s from private.geocode_rate_state where provider = 'p'`))[0]!.s);
  assert(seconds <= 3_601, `pausa de ${seconds} s`);
  await rows(a!, `select public.geocode_reserve_slot('q', 2000000000, 2000000000)`);
  await rows(a!, `select public.geocode_reserve_slot('q', 1000, 4000)`);
  seconds = Number((await rows(ctx.admin, `select extract(epoch from (next_slot_at - clock_timestamp())) as s from private.geocode_rate_state where provider = 'q'`))[0]!.s);
  assert(seconds <= 120, `turno a ${seconds} s: el intervalo debe tener tope`);
  await rows(a!, `select * from public.geocode_claim('p', 'largo', 'x', 2000000000)`);
  const lease = Number((await rows(ctx.admin, `select extract(epoch from (lease_until - clock_timestamp())) as s from private.geocode_cache where query_key = 'largo'`))[0]!.s);
  assert(lease <= 301, `lease de ${lease} s`);
});

// ================================================================== geocode-place completo sobre PostgreSQL real

const request3 = async (ctx: Ctx, count: number, env: Record<string, string>, log: { q: string; at: number }[]) => {
  const cs = await ctx.conns(count);
  return cs.map((c) => pgDeps(c, { env, fetch: simulatedProvider(log) }));
};

test('intervalo global con el Nominatim público: consultas DISTINTAS desde 3 instancias a la vez salen espaciadas ≥ 1 s', async (ctx) => {
  resetInflight();
  const log: { q: string; at: number }[] = [];
  const instances = await request3(ctx, 3, {}, log); // configuración por defecto = Nominatim público
  const queries = ['plaza mayor madrid', 'sagrada familia barcelona', 'alhambra granada', 'giralda sevilla', 'prado madrid', 'park güell barcelona'];
  // Caben 4 turnos (0; 1,1; 2,2 y 3,3 s) dentro de la espera máxima de 4 s; la 5.ª y la 6.ª consultas simultáneas reciben «ocupado»
  // (429) SIN llegar al proveedor: la cola nunca crece sin límite.
  const responses = await Promise.all(queries.map((q, i) => request(instances[i % 3]!, q)));
  assertEquals(responses.filter((r) => r.status === 200 && r.body.results.length === 1).length, 4, JSON.stringify(responses.map((r) => r.body.error)));
  assertEquals(responses.filter((r) => r.status === 429 && r.body.error === 'busy').length, 2);
  const times = log.map((l) => l.at).sort((a, b) => a - b);
  assertEquals(times.length, 4, 'las consultas «ocupado» no llegan al proveedor');
  for (let i = 1; i < times.length; i++) assert(times[i]! - times[i - 1]! >= 1000, `huecos (ms): ${times.map((t) => t - times[0]!).join(', ')}`);
});

test('el mínimo de 1 s no se puede reducir con la configuración (Nominatim público): 0, 1, valores negativos y no numéricos', async (ctx) => {
  for (const interval of ['0', '1', '-5', '250', 'abc', '999.5']) {
    resetInflight();
    await ctx.admin.query('delete from private.geocode_rate_state');
    const log: { q: string; at: number }[] = [];
    const [a, b] = await request3(ctx, 2, { GEOCODER_MIN_INTERVAL_MS: interval }, log);
    const both = await Promise.all([request(a!, `consulta uno ${interval}`), request(b!, `consulta dos ${interval}`)]);
    assertEquals(log.length, 2, `GEOCODER_MIN_INTERVAL_MS=${interval}: ${JSON.stringify(both.map((r) => [r.status, r.body.error]))}`);
    assert(Math.abs(log[1]!.at - log[0]!.at) >= 1000, `GEOCODER_MIN_INTERVAL_MS=${interval}: hueco ${Math.abs(log[1]!.at - log[0]!.at)} ms`);
  }
});

test('procesos Deno SEPARADOS (instancias reales): consultas distintas respetan el intervalo y la compartida se consulta una sola vez', async (ctx) => {
  const dir = await Deno.makeTempDir({ prefix: 'geocode-children-' });
  try {
    const children = [0, 1, 2].map((i) => {
      const logFile = `${dir}/child${i}.log`;
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--no-check', '-A', CHILD, PG_URL!, 'record', logFile, '{}', `consulta única ${i}`, 'consulta compartida'],
        stdout: 'piped',
        stderr: 'piped'
      });
      return { logFile, output: command.output() };
    });
    const outputs = await Promise.all(children.map((c) => c.output));
    const calls: { at: number; q: string }[] = [];
    for (const [i, c] of children.entries()) {
      assertEquals(outputs[i]!.code, 0, new TextDecoder().decode(outputs[i]!.stderr));
      const lines = Deno.readTextFileSync(c.logFile).trim().split('\n');
      const done = JSON.parse(lines.find((l) => l.startsWith('DONE '))!.slice(5)) as { status: number; error: string | null }[];
      assert(done.every((d) => d.status === 200), `hijo ${i}: ${JSON.stringify(done)}`);
      for (const l of lines.filter((l) => l.startsWith('CALL '))) {
        const [, at, ...q] = l.split(' ');
        calls.push({ at: Number(at), q: q.join(' ') });
      }
    }
    assertEquals(calls.filter((c) => c.q === 'consulta compartida').length, 1, 'la consulta compartida debe ir al proveedor UNA sola vez');
    assertEquals(calls.length, 4);
    const times = calls.map((c) => c.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert(times[i]! - times[i - 1]! >= 1000, `huecos entre procesos (ms): ${times.map((t) => t - times[0]!).join(', ')}`);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}, 180_000);

test('instancia congelada y matada a mitad de consulta: otras instancias no se cuelgan y se recuperan al vencer la reserva', async (ctx) => {
  const dir = await Deno.makeTempDir({ prefix: 'geocode-hang-' });
  const env = { GEOCODER_TIMEOUT_MS: '1000' }; // lease = turno máximo + timeout + margen (≈ 10 s)
  try {
    const logFile = `${dir}/hang.log`;
    const child = new Deno.Command(Deno.execPath(), {
      args: ['run', '--no-check', '-A', CHILD, PG_URL!, 'hang', logFile, JSON.stringify(env), 'consulta colgada'],
      stdout: 'null',
      stderr: 'null'
    }).spawn();
    // Espera a que haya reclamado y esté colgada en el proveedor.
    for (let i = 0; i < 100 && !(await Deno.stat(logFile).then(() => true, () => false)); i++) await sleep(200);
    assert(Deno.readTextFileSync(logFile).includes('CLAIMED'), 'el hijo no llegó a consultar al proveedor');
    const pending = await rows(ctx.admin, `select status, lease_until from private.geocode_cache`);
    assertEquals(pending.map((r) => r.status), ['pending']);
    child.kill('SIGKILL'); // la instancia muere sin liberar nada
    await child.status;

    const log: { q: string; at: number }[] = [];
    const [other] = await request3(ctx, 1, env, log);
    const t0 = Date.now();
    const first = await request(other!, 'consulta colgada');
    assert(Date.now() - t0 < 12_000, `la petición se quedó esperando ${Date.now() - t0} ms`);
    assert(first.status === 429 || first.status === 200, `estado ${first.status} ${first.body.error}`);

    // Pasado el lease, la siguiente petición ya consulta al proveedor y guarda: ningún bloqueo permanente.
    const leaseLeft = Number((await rows(ctx.admin, `select extract(epoch from (max(lease_until) - clock_timestamp())) as s from private.geocode_cache where status = 'pending'`))[0]?.s ?? 0);
    if (leaseLeft > 0) await sleep(leaseLeft * 1000 + 500);
    const second = await request(other!, 'consulta colgada');
    assertEquals([second.status, second.body.success], [200, true], JSON.stringify(second.body) + ' filas: ' + JSON.stringify(await rows(ctx.admin, 'select provider, query_key, status, lease_until, expires_at, now() as ahora from private.geocode_cache')) + ' turno: ' + JSON.stringify(await rows(ctx.admin, 'select next_slot_at, clock_timestamp() as ahora from private.geocode_rate_state')));
    const final = await rows(ctx.admin, `select status from private.geocode_cache`);
    assertEquals(final.map((r) => r.status), ['ready']);
  } finally {
    await Deno.remove(dir, { recursive: true }).catch(() => undefined);
  }
}, 180_000);

test('errores del proveedor: no dejan reservas ni turnos atascados, y el 429 pausa a TODAS las instancias hasta recuperarse', async (ctx) => {
  resetInflight();
  const [a, b] = await ctx.conns(2);
  const provider429: typeof fetch = (() => Promise.resolve(new Response('', { status: 429, headers: { 'retry-after': '60' } }))) as typeof fetch;
  const limited = await request(pgDeps(a!, { fetch: provider429 }), 'consulta con limite');
  assertEquals([limited.status, limited.body.error], [429, 'provider_limited']);
  assertEquals((await rows(ctx.admin, `select count(*) as n from private.geocode_cache where query_key <> '!provider-pause'`))[0]!.n, '0');

  // Otra instancia, otra consulta: no llega al proveedor mientras dure la pausa; recibe lo que falta de la pausa del proveedor.
  resetInflight();
  const log: { q: string; at: number }[] = [];
  const during = await request(pgDeps(b!, { fetch: simulatedProvider(log) }), 'otra consulta distinta');
  assertEquals([during.status, during.body.error, log.length], [429, 'provider_limited', 0]);
  assert(during.body.retryAfterSeconds > 50 && during.body.retryAfterSeconds <= 60, String(during.body.retryAfterSeconds));
  const reserved = Number((await rows(ctx.admin, `select extract(epoch from (next_slot_at - clock_timestamp())) as s from private.geocode_rate_state`))[0]!.s);
  assert(reserved > 30 && reserved <= 61, `pausa de ${reserved} s`);

  // «Pasa el tiempo»: al vencer la pausa todo vuelve a funcionar.
  await ctx.admin.query(`update private.geocode_rate_state set next_slot_at = now()`);
  await ctx.admin.query(`update private.geocode_cache set expires_at = now() - interval '1 second' where query_key = '!provider-pause'`);
  resetInflight();
  const after = await request(pgDeps(b!, { fetch: simulatedProvider(log) }), 'otra consulta distinta');
  assertEquals([after.status, after.body.success, log.length], [200, true, 1]);

  // 500 y red caída: tampoco dejan nada pendiente.
  for (const failing of [(() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch, (() => Promise.reject(new TypeError('red'))) as typeof fetch]) {
    resetInflight();
    const r = await request(pgDeps(a!, { fetch: failing }), `consulta fallida ${Math.random()}`);
    assert(r.status >= 500, String(r.status));
  }
  assertEquals((await rows(ctx.admin, `select count(*) as n from private.geocode_cache where status = 'pending'`))[0]!.n, '0');
});

test('un proveedor que no responde: timeout configurable, 504 y la reserva se libera', async (ctx) => {
  resetInflight();
  const [a] = await ctx.conns(1);
  const never: typeof fetch = ((_input: unknown, init?: RequestInit) =>
    new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)))) as typeof fetch;
  const t0 = Date.now();
  const r = await request(pgDeps(a!, { env: { GEOCODER_TIMEOUT_MS: '1000' }, fetch: never }), 'consulta sin respuesta');
  assertEquals([r.status, r.body.error], [504, 'timeout'], JSON.stringify(r.body) + ' filas: ' + JSON.stringify(await rows(ctx.admin, 'select provider, query_key, status from private.geocode_cache')) + ' turno: ' + JSON.stringify(await rows(ctx.admin, 'select next_slot_at, clock_timestamp() as ahora from private.geocode_rate_state')));
  assert(Date.now() - t0 >= 900 && Date.now() - t0 < 6_000, `${Date.now() - t0} ms`);
  assertEquals((await rows(ctx.admin, 'select count(*) as n from private.geocode_cache'))[0]!.n, '0');
});

// ================================================================== aislamiento de la caché

test('cambiar el idioma o el proveedor/endpoint NO reutiliza entradas de caché incompatibles; repetir la misma configuración sí', async (ctx) => {
  resetInflight();
  const [c] = await ctx.conns(1);
  const log: { q: string; at: number }[] = [];
  const ask = (env: Record<string, string>) => {
    resetInflight();
    return request(pgDeps(c!, { env: { GEOCODER_MIN_INTERVAL_MS: '50', ...env }, fetch: simulatedProvider(log) }), 'plaza mayor madrid');
  };
  const base = { GEOCODER_BASE_URL: 'https://geo-a.example.test' };
  const first = await ask(base);
  assertEquals(first.body.cached, false);
  assertEquals((await ask(base)).body.cached, true, 'misma configuración: reutiliza la caché');
  assertEquals(log.length, 1);

  assertEquals((await ask({ ...base, GEOCODER_LANGUAGE: 'en' })).body.cached, false, 'otro idioma: no reutiliza');
  assertEquals((await ask({ GEOCODER_BASE_URL: 'https://geo-b.example.test' })).body.cached, false, 'otro endpoint: no reutiliza');
  assertEquals((await ask({ GEOCODER_BASE_URL: 'https://geo-b.example.test', GEOCODER_LANGUAGE: 'en' })).body.cached, false);
  assertEquals(log.length, 4);

  const stored = await rows(ctx.admin, `select provider, query_key from private.geocode_cache order by 1, 2`);
  assertEquals(new Set(stored.map((r) => `${r.provider}|${r.query_key}`)).size, 4, JSON.stringify(stored));
  assertEquals(new Set(stored.map((r) => r.provider)).size, 2, 'un ámbito por endpoint');
  assert(stored.every((r) => String(r.provider).length <= 40));
  // Y cada endpoint tiene su propio turno global.
  assertEquals(Number((await rows(ctx.admin, 'select count(*) as n from private.geocode_rate_state'))[0]!.n), 2);
  assertNotEquals(stored[0]!.provider, stored.at(-1)!.provider);
});

test('Retry-After de 2 h: la pausa COMPLETA vive en la base y no se vuelve a consultar al cumplirse una hora; vence sola al terminar', async (ctx) => {
  resetInflight();
  const [a, b] = await ctx.conns(2);
  const provider429: typeof fetch = (() => Promise.resolve(new Response('Too many requests', { status: 429, headers: { 'retry-after': '7200' } }))) as typeof fetch;
  const first = await request(pgDeps(a!, { fetch: provider429 }), 'consulta con pausa larga');
  assertEquals([first.status, first.body.error, first.body.retryAfterSeconds, first.body.retryAfterSource, first.body.providerStatus], [429, 'provider_limited', 7200, 'provider', 429]);

  const remaining = async () => Number((await rows(ctx.admin, `select extract(epoch from (expires_at - now())) as s from private.geocode_cache where query_key = '!provider-pause'`))[0]!.s);
  const s0 = await remaining();
  assert(s0 > 7190 && s0 <= 7200, `el marcador debe durar la pausa completa: ${s0} s`);
  // El turno de la base solo admite 1 h; la pausa completa está en el marcador.
  const turn = Number((await rows(ctx.admin, `select extract(epoch from (next_slot_at - clock_timestamp())) as s from private.geocode_rate_state`))[0]!.s);
  assert(turn > 3590 && turn <= 3600, `turno de la base: ${turn} s`);

  // Otra instancia, otra consulta: no llega al proveedor.
  const log: { q: string; at: number }[] = [];
  const during = async () => { resetInflight(); return await request(pgDeps(b!, { fetch: simulatedProvider(log) }), 'otra consulta distinta'); };
  const r1 = await during();
  assertEquals([r1.status, r1.body.error, log.length], [429, 'provider_limited', 0]);
  assert(r1.body.retryAfterSeconds > 7190);

  // «Pasa» más de una hora (quedan 3500 s de pausa y el turno de la base, que solo admite 1 h, ya venció): SIGUE en pausa.
  await ctx.admin.query(`update private.geocode_rate_state set next_slot_at = now()`);
  await ctx.admin.query(`update private.geocode_cache set expires_at = now() + interval '3500 seconds',
    results = jsonb_build_array(jsonb_set(results -> 0, '{until}', to_jsonb((extract(epoch from now()) * 1000 + 3500000)::bigint))) where query_key = '!provider-pause'`);
  const r2 = await during();
  assertEquals([r2.status, r2.body.error, log.length], [429, 'provider_limited', 0], 'tras 1 h todavía no se puede consultar');
  assert(r2.body.retryAfterSeconds > 3490 && r2.body.retryAfterSeconds <= 3500, String(r2.body.retryAfterSeconds));

  // Se cumple la espera completa: vuelve a consultar.
  await ctx.admin.query(`update private.geocode_cache set expires_at = now() - interval '1 second' where query_key = '!provider-pause'`);
  const r3 = await during();
  assertEquals([r3.status, r3.body.success, log.length], [200, true, 1]);
  assertEquals(Number((await rows(ctx.admin, `select count(*) as n from private.geocode_cache where query_key = '!provider-pause'`))[0]!.n), 0);
});

// ================================================================== 0058: límite diario atómico

const take = async (c: PgClient, scope: string, limit: number, doTake = true) =>
  (await rows(c, 'select allowed, used, resets_in_seconds from public.geocode_quota_take($1, $2, $3)', [scope, limit, doTake]))[0] as { allowed: boolean; used: number; resets_in_seconds: number };

test('0058 permisos: anon y authenticated no pueden ejecutar geocode_quota_take ni leer la tabla; service_role sí', async (ctx) => {
  for (const role of ['anon', 'authenticated']) {
    const c = await ctx.conn(role);
    for (const sql of [`select * from public.geocode_quota_take('s', 10, true)`, 'select * from private.geocode_daily_usage']) {
      let denied = false;
      try {
        await c.query(sql);
      } catch (e) {
        denied = /permission denied/.test(String((e as Error).message));
      }
      assert(denied, `${role} no debería poder: ${sql}`);
    }
  }
  const svc = await ctx.conn();
  assertEquals((await take(svc, 's', 10)).allowed, true);
});

test('0058 consumo: take = false solo informa; take = true consume de uno en uno y informa la renovación (≤ 24 h)', async (ctx) => {
  const c = await ctx.conn();
  assertEquals(await take(c, 's', 3, false).then((r) => [r.allowed, r.used]), [true, 0]);
  const first = await take(c, 's', 3);
  assertEquals([first.allowed, first.used], [true, 1]);
  assert(first.resets_in_seconds > 0 && first.resets_in_seconds <= 86_400, String(first.resets_in_seconds));
  await take(c, 's', 3);
  assertEquals(await take(c, 's', 3, false).then((r) => [r.allowed, r.used]), [true, 2]);
  assertEquals(await take(c, 's', 3).then((r) => [r.allowed, r.used]), [true, 3]);
  assertEquals(await take(c, 's', 3).then((r) => [r.allowed, r.used]), [false, 3], 'al agotarse no se consume más');
  assertEquals(await take(c, 's', 3, false).then((r) => [r.allowed, r.used]), [false, 3]);
  assertEquals(await take(c, 'otro', 3).then((r) => [r.allowed, r.used]), [true, 1], 'cada ámbito tiene su propio contador');
});

test('0058 concurrencia REAL: 80 conexiones piden consumir con límite 25 → exactamente 25 permitidas; el contador nunca supera el límite', async (ctx) => {
  const cs = await ctx.conns(80);
  const results = await Promise.all(cs.map((c) => take(c, 's', 25)));
  assertEquals(results.filter((r) => r.allowed).length, 25);
  assertEquals(results.filter((r) => !r.allowed).length, 55);
  assertEquals(new Set(results.filter((r) => r.allowed).map((r) => r.used)).size, 25, 'cada llamada permitida recibe un número distinto (1…25)');
  assert(results.every((r) => r.used >= 0 && r.used <= 25));
  const stored = await rows(ctx.admin, "select calls from private.geocode_daily_usage where scope = 's'");
  assertEquals(stored.map((r) => r.calls), [25]);
});

test('0058 cambio de día: el consumo de ayer no cuenta hoy; los días de hace más de 7 se limpian solos', async (ctx) => {
  const c = await ctx.conn();
  await ctx.admin.query(`insert into private.geocode_daily_usage (scope, day, calls) values
    ('s', (now() at time zone 'utc')::date - 1, 500), ('s', (now() at time zone 'utc')::date - 30, 500), ('s', (now() at time zone 'utc')::date - 9, 7)`);
  assertEquals(await take(c, 's', 500).then((r) => [r.allowed, r.used]), [true, 1], 'ayer estaba agotado pero hoy es otro día');
  const days = await rows(ctx.admin, "select (now() at time zone 'utc')::date - day as ago from private.geocode_daily_usage where scope = 's' order by 1");
  assertEquals(days.map((r) => Number(r.ago)), [0, 1], 'las filas de hace más de 7 días se borraron');
});

test('0058 valores absurdos: el límite se acota (1–100000) y nunca bloquea para siempre', async (ctx) => {
  const c = await ctx.conn();
  assertEquals(await take(c, 'a', 0).then((r) => [r.allowed, r.used]), [true, 1], 'límite 0 se trata como 1');
  assertEquals(await take(c, 'a', 0).then((r) => r.allowed), false);
  assertEquals(await take(c, 'b', -5).then((r) => r.allowed), true);
  assertEquals(await take(c, 'c', 2_000_000_000).then((r) => r.allowed), true);
  const used = await rows(ctx.admin, "select calls from private.geocode_daily_usage where scope = 'c'");
  assertEquals(used[0]!.calls, 1);
});

test('0058 sin bloqueos permanentes: con la fila retenida por otra transacción responde «ocupado» (used = -1, NO permite) y se recupera al soltarse', async (ctx) => {
  const c = await ctx.conn();
  await take(c, 's', 10);
  const holder = await connectAs(PG_URL!, 'postgres');
  await holder.query("begin; select * from private.geocode_daily_usage where scope = 's' for update");
  const started = Date.now();
  const blocked = await Promise.race([take(c, 's', 10), sleep(8_000).then(() => 'BLOQUEADO' as const)]);
  assert(blocked !== 'BLOQUEADO', 'la función quedó esperando el bloqueo');
  assertEquals([blocked.allowed, blocked.used], [false, -1], 'falla CERRADO: no permite la llamada');
  assert(Date.now() - started < 4_000, `tardó ${Date.now() - started} ms`);
  const pid = (await rows(holder, 'select pg_backend_pid() as pid'))[0]!.pid;
  await rows(ctx.admin, 'select pg_terminate_backend($1)', [pid]);
  assertEquals((await take(c, 's', 10)).allowed, true);
  await holder.end().catch(() => undefined);
});

// ================================================================== Geoapify de extremo a extremo (proveedor SIEMPRE simulado)

const GEO_KEY = 'test_key_1234567890abcdef';
const geoEnv = (extra: Record<string, string> = {}) => ({ GEOCODER_PROVIDER: 'geoapify', GEOAPIFY_API_KEY: GEO_KEY, ...extra });
const geoProvider = (log: { q: string; at: number }[]) =>
  ((input: Request | URL | string) => {
    const q = String(new URL(String(input)).searchParams.get('text'));
    log.push({ q, at: Date.now() });
    return Promise.resolve(new Response(fakeGeoapifyBody(q)));
  }) as typeof fetch;

test('Geoapify con la base real: devuelve candidatos con procedencia, guarda en caché y la repetición no llama ni consume', async (ctx) => {
  resetInflight();
  const [c] = await ctx.conns(1);
  const log: { q: string; at: number }[] = [];
  const ask = (q: string) => {
    resetInflight();
    return request(pgDeps(c!, { env: geoEnv(), fetch: geoProvider(log) }), q);
  };
  const first = await ask('torre de belem, lisboa');
  assertEquals([first.status, first.body.success, first.body.cached, first.body.results[0].geocoder, first.body.results[0].osmId], [200, true, false, 'geoapify', null]);
  const again = await ask('Torre de  BELEM,Lisboa');
  assertEquals([again.status, again.body.cached, log.length], [200, true, 1]);
  const usage = await rows(ctx.admin, 'select scope, calls from private.geocode_daily_usage');
  assertEquals(usage.map((r) => r.calls), [1]);
  assert(String(usage[0]!.scope).startsWith('geoapify:'));
  const cacheText = JSON.stringify(await rows(ctx.admin, 'select * from private.geocode_cache'));
  assert(!cacheText.includes(GEO_KEY) && !cacheText.includes('apiKey'), 'la clave no llega a la caché');
});

test('Geoapify: límite diario compartido por 3 instancias (conexiones independientes) y 6 búsquedas nuevas simultáneas con límite 3 → exactamente 3 llamadas, espaciadas ≥ 1 s', async (ctx) => {
  resetInflight();
  const conns = await ctx.conns(3);
  const log: { q: string; at: number }[] = [];
  const instances = conns.map((c) => pgDeps(c, { env: geoEnv({ GEOCODER_DAILY_LIMIT: '3' }), fetch: geoProvider(log) }));
  const responses = await Promise.all(Array.from({ length: 6 }, (_, k) => request(instances[k % 3]!, `lugar de prueba ${k}`)));
  const ok = responses.filter((r) => r.status === 200);
  assertEquals(ok.length, 3, JSON.stringify(responses.map((r) => r.body.error ?? 'ok')));
  assert(responses.filter((r) => r.status !== 200).every((r) => r.body.error === 'quota_exhausted' || r.body.error === 'busy'), JSON.stringify(responses.map((r) => r.body.error)));
  assertEquals(log.length, 3, 'el proveedor recibe exactamente 3 llamadas');
  const times = log.map((l) => l.at).sort((a, b) => a - b);
  for (let i = 1; i < times.length; i++) assert(times[i]! - times[i - 1]! >= 1000, `huecos (ms): ${times.map((t) => t - times[0]!).join(', ')}`);
  const usage = await rows(ctx.admin, 'select calls from private.geocode_daily_usage');
  assertEquals(usage.map((r) => r.calls), [3]);
});

test('Geoapify: cada intento cuenta (errores incluidos); agotado el límite se sirve lo cacheado y las búsquedas nuevas reciben quota_exhausted SIN llamar', async (ctx) => {
  resetInflight();
  const [a, b] = await ctx.conns(2);
  const log: { q: string; at: number }[] = [];
  const env = geoEnv({ GEOCODER_DAILY_LIMIT: '3' });
  const ok = await request(pgDeps(a!, { env, fetch: geoProvider(log) }), 'lugar cacheado, lisboa');
  assertEquals(ok.status, 200);
  // Dos intentos que acaban en error (500 y red caída): también consumen.
  for (const failing of [(() => Promise.resolve(new Response('', { status: 500 }))) as typeof fetch, (() => Promise.reject(new TypeError('red'))) as typeof fetch]) {
    resetInflight();
    await ctx.admin.query('update private.geocode_rate_state set next_slot_at = now()');
    const r = await request(pgDeps(b!, { env, fetch: failing }), `consulta que falla ${Math.random()}`);
    assert(r.status >= 500, String(r.status));
  }
  assertEquals((await rows(ctx.admin, 'select calls from private.geocode_daily_usage'))[0]!.calls, 3);

  resetInflight();
  const blocked = await request(pgDeps(a!, { env, fetch: geoProvider(log) }), 'una búsqueda nueva más');
  assertEquals([blocked.status, blocked.body.error, blocked.body.dailyLimit, log.length], [429, 'quota_exhausted', 3, 1]);
  assert(blocked.body.retryAfterSeconds > 0 && blocked.body.retryAfterSeconds <= 86_400);

  resetInflight();
  const cached = await request(pgDeps(a!, { env, fetch: geoProvider(log) }), 'lugar cacheado, lisboa');
  assertEquals([cached.status, cached.body.cached, log.length], [200, true, 1], 'lo ya buscado sigue disponible con el límite agotado');
  assertEquals((await rows(ctx.admin, 'select calls from private.geocode_daily_usage'))[0]!.calls, 3, 'ni el rechazo ni la caché consumen');

  // Al día siguiente (simulado) vuelve a funcionar.
  await ctx.admin.query("update private.geocode_daily_usage set day = day - 1");
  await ctx.admin.query('update private.geocode_rate_state set next_slot_at = now()');
  resetInflight();
  const next = await request(pgDeps(a!, { env, fetch: geoProvider(log) }), 'una búsqueda nueva más');
  assertEquals([next.status, next.body.success, log.length], [200, true, 2]);
});

test('Geoapify con procesos Deno SEPARADOS: el límite diario y el intervalo de 1 s se comparten entre instancias reales', async (ctx) => {
  const dir = await Deno.makeTempDir({ prefix: 'geocode-geoapify-' });
  try {
    const env = JSON.stringify(geoEnv({ GEOCODER_DAILY_LIMIT: '3' }));
    const children = [0, 1, 2].map((i) => {
      const logFile = `${dir}/child${i}.log`;
      const command = new Deno.Command(Deno.execPath(), {
        args: ['run', '--no-check', '-A', CHILD, PG_URL!, 'record', logFile, env, `lugar único ${i}`, 'lugar compartido'],
        stdout: 'piped',
        stderr: 'piped'
      });
      return { logFile, output: command.output() };
    });
    const outputs = await Promise.all(children.map((c) => c.output));
    const calls: { at: number; q: string }[] = [];
    for (const [i, c] of children.entries()) {
      assertEquals(outputs[i]!.code, 0, new TextDecoder().decode(outputs[i]!.stderr));
      const lines = Deno.readTextFileSync(c.logFile).trim().split('\n');
      for (const l of lines.filter((l) => l.startsWith('CALL '))) {
        const [, at, ...q] = l.split(' ');
        calls.push({ at: Number(at), q: q.join(' ') });
      }
    }
    assertEquals(calls.length, 3, 'entre los 3 procesos solo caben 3 llamadas al proveedor');
    assertEquals(calls.filter((c) => c.q === 'lugar compartido').length <= 1, true, 'la consulta compartida va al proveedor como mucho una vez');
    const times = calls.map((c) => c.at).sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) assert(times[i]! - times[i - 1]! >= 1000, `huecos entre procesos (ms): ${times.map((t) => t - times[0]!).join(', ')}`);
    const usage = await rows(ctx.admin, 'select calls from private.geocode_daily_usage');
    assertEquals(usage.map((r) => r.calls), [3]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}, 180_000);

test('Geoapify: sin clave NO se llama ni se consume; el proveedor y el idioma separan la caché y el consumo', async (ctx) => {
  resetInflight();
  const [c] = await ctx.conns(1);
  const log: { q: string; at: number }[] = [];
  const noKey = await request(pgDeps(c!, { env: { GEOCODER_PROVIDER: 'geoapify' }, fetch: geoProvider(log) }), 'torre de belem');
  assertEquals([noKey.status, noKey.body.error, log.length], [503, 'provider_not_configured', 0]);
  assertEquals((await rows(ctx.admin, 'select count(*)::int as n from private.geocode_daily_usage'))[0]!.n, 0);

  const ask = (env: Record<string, string>) => {
    resetInflight();
    return request(pgDeps(c!, { env, fetch: geoProvider(log) }), 'plaza mayor, madrid');
  };
  await ctx.admin.query('delete from private.geocode_rate_state');
  assertEquals((await ask(geoEnv())).body.cached, false);
  assertEquals((await ask(geoEnv())).body.cached, true);
  await ctx.admin.query('update private.geocode_rate_state set next_slot_at = now()');
  assertEquals((await ask(geoEnv({ GEOCODER_LANGUAGE: 'en' }))).body.cached, false, 'otro idioma no reutiliza');
  const scopes = await rows(ctx.admin, 'select scope, calls from private.geocode_daily_usage order by 1');
  assertEquals(scopes.length, 1);
  assertEquals(scopes[0]!.calls, 2);
  // Rotar la clave no invalida la caché (la clave no forma parte del ámbito).
  assertEquals((await ask(geoEnv({ GEOAPIFY_API_KEY: 'otra_clave_distinta_123456' }))).body.cached, true);
});
