// Prueba de la migración REAL 0057 (caché y coordinación de geocode-place), su verify y su rollback, contra Postgres en memoria (PGlite).
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { PGlite } from 'npm:@electric-sql/pglite@0.3';

const read = (name: string) => Deno.readTextFileSync(new URL(`../../migrations/${name}`, import.meta.url));
const readScript = (name: string) => Deno.readTextFileSync(new URL(`../../migration-scripts/${name}`, import.meta.url));

async function migrated(): Promise<PGlite> {
  const db = new PGlite();
  // Roles de Supabase que usan los permisos de la migración.
  await db.exec(`create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
                 create schema if not exists private; grant usage on schema public to anon, authenticated, service_role;
                 grant usage on schema private to service_role;`);
  await db.exec(read('0057_geocode_cache.sql'));
  return db;
}

const asRole = async <T>(db: PGlite, role: string, fn: () => Promise<T>): Promise<T> => {
  await db.exec(`set role ${role}`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
  }
};

type Claim = { state: string; results: unknown };
const claim = async (db: PGlite, key: string, lease = 30) =>
  (await db.query<Claim>(`select * from public.geocode_claim('nominatim', '${key}', 'consulta', ${lease})`)).rows[0]!;
const reserve = async (db: PGlite, interval = 1100, maxWait = 4000) =>
  (await db.query<{ w: number }>(`select public.geocode_reserve_slot('nominatim', ${interval}, ${maxWait}) as w`)).rows[0]!.w;

Deno.test('0057: el verify real devuelve ok = true en todas las filas', async () => {
  const db = await migrated();
  const rows = (await db.query<{ n: number; check: string; ok: boolean }>(readScript('0057_geocode_cache_verify.sql'))).rows;
  assertEquals(rows.length, 6);
  for (const r of rows) assert(r.ok, `verify ${r.n}: ${r.check}`);
});

Deno.test('0057: es idempotente (se puede aplicar dos veces)', async () => {
  const db = await migrated();
  await db.exec(read('0057_geocode_cache.sql'));
  assertEquals((await claim(db, 'k')).state, 'claimed');
});

Deno.test('0057: anon y authenticated no pueden llamar a las funciones ni leer las tablas; service_role sí', async () => {
  const db = await migrated();
  for (const role of ['anon', 'authenticated']) {
    await asRole(db, role, async () => {
      await assertRejects(() => db.query(`select * from public.geocode_claim('nominatim', 'k', 'q', 30)`), Error, 'permission denied');
      await assertRejects(() => db.query(`select public.geocode_reserve_slot('nominatim', 1100, 4000)`), Error, 'permission denied');
      await assertRejects(() => db.query(`select public.geocode_cache_purge()`), Error, 'permission denied');
      await assertRejects(() => db.query('select * from private.geocode_cache'), Error, 'permission denied');
    });
  }
  const state = await asRole(db, 'service_role', async () => (await claim(db, 'k')).state);
  assertEquals(state, 'claimed');
});

Deno.test('0057: claim → claimed; mientras está pendiente otra consulta espera; store → hit con los resultados', async () => {
  const db = await migrated();
  assertEquals((await claim(db, 'torre')).state, 'claimed');
  assertEquals((await claim(db, 'torre')).state, 'wait');
  await db.exec(`select public.geocode_store('nominatim', 'torre', '[{"name":"Torre"}]'::jsonb, 3600)`);
  const hit = await claim(db, 'torre');
  assertEquals([hit.state, hit.results], ['hit', [{ name: 'Torre' }]]);
  assertEquals((await claim(db, 'otra')).state, 'claimed');
});

Deno.test('0057: una lista vacía también se cachea; release libera la reserva (los errores no se cachean)', async () => {
  const db = await migrated();
  await claim(db, 'vacio');
  await db.exec(`select public.geocode_store('nominatim', 'vacio', '[]'::jsonb, 3600)`);
  assertEquals(await claim(db, 'vacio'), { state: 'hit', results: [] });

  await claim(db, 'falla');
  await db.exec(`select public.geocode_release('nominatim', 'falla')`);
  assertEquals((await claim(db, 'falla')).state, 'claimed');
  // release no borra resultados ya guardados.
  await db.exec(`select public.geocode_release('nominatim', 'vacio')`);
  assertEquals((await claim(db, 'vacio')).state, 'hit');
});

Deno.test('0057: caché vencida se reclama de nuevo; una reserva abandonada (lease vencido) también', async () => {
  const db = await migrated();
  await claim(db, 'a');
  await db.exec(`select public.geocode_store('nominatim', 'a', '[{"x":1}]'::jsonb, 3600)`);
  await db.exec(`update private.geocode_cache set expires_at = now() - interval '1 second' where query_key = 'a'`);
  assertEquals((await claim(db, 'a')).state, 'claimed');

  await db.exec(`update private.geocode_cache set expires_at = now() - interval '1 second' where query_key = 'a' and status = 'pending'`);
  assertEquals((await claim(db, 'a')).state, 'claimed');
});

Deno.test('0057: limpieza — claim borra lo vencido de forma acotada y geocode_cache_purge borra el resto', async () => {
  const db = await migrated();
  for (let i = 0; i < 40; i++) {
    await db.exec(`insert into private.geocode_cache (provider, query_key, query_text, status, results, expires_at)
                   values ('nominatim', 'old${i}', 'x', 'ready', '[]', now() - interval '1 day')`);
  }
  await db.exec(`insert into private.geocode_cache (provider, query_key, query_text, status, results, expires_at)
                 values ('nominatim', 'vigente', 'x', 'ready', '[]', now() + interval '1 day')`);
  await claim(db, 'nueva');
  const left = (await db.query<{ n: number }>(`select count(*)::int as n from private.geocode_cache where query_key like 'old%'`)).rows[0]!.n;
  assertEquals(left, 15, 'cada claim borra como máximo 25 filas vencidas');

  const purged = (await db.query<{ p: number }>(`select public.geocode_cache_purge() as p`)).rows[0]!.p;
  assertEquals(purged, 15);
  const keys = (await db.query<{ query_key: string }>(`select query_key from private.geocode_cache order by 1`)).rows.map((r) => r.query_key);
  assertEquals(keys, ['nueva', 'vigente']);
});

Deno.test('0057: los turnos globales se reparten sin solaparse (0, 1100, 2200… ms) y no hay dos iguales', async () => {
  const db = await migrated();
  const waits: number[] = [];
  for (let i = 0; i < 4; i++) waits.push(await reserve(db, 1000, 10_000));
  assert(waits[0]! <= 5, `el primero no espera: ${waits}`);
  for (let i = 1; i < waits.length; i++) {
    const gap = waits[i]! - waits[i - 1]!;
    assert(gap >= 990 && gap <= 1010, `huecos de 1000 ms: ${waits}`);
  }
});

Deno.test('0057: reservas lanzadas a la vez (varias «instancias») nunca reciben el mismo turno', async () => {
  const db = await migrated();
  const waits = await Promise.all(Array.from({ length: 10 }, () => reserve(db, 1000, 60_000)));
  const sorted = [...waits].sort((a, b) => a - b);
  for (let i = 1; i < sorted.length; i++) assert(sorted[i]! - sorted[i - 1]! >= 900, `turnos solapados: ${sorted}`);
});

Deno.test('0057: si la espera supera el máximo devuelve -1 y NO reserva; backoff pausa a todas las instancias', async () => {
  const db = await migrated();
  assert((await reserve(db, 1000, 4000)) <= 5);
  assert((await reserve(db, 1000, 4000)) > 900, 'el segundo espera ~1 s');
  await db.exec(`select public.geocode_backoff('nominatim', 120)`);
  assertEquals(await reserve(db, 1000, 4000), -1);
  const next = (await db.query<{ s: number }>(`select extract(epoch from (next_slot_at - clock_timestamp()))::int as s from private.geocode_rate_state`)).rows[0]!.s;
  assert(next >= 118 && next <= 121, `la pausa se conserva: ${next}`);
  // Otro proveedor tiene su propio turno.
  assert((await db.query<{ w: number }>(`select public.geocode_reserve_slot('otro', 1000, 4000) as w`)).rows[0]!.w <= 5);
});

Deno.test('0057: rollback deja la base sin objetos de geocode y no toca nada más', async () => {
  const db = await migrated();
  await db.exec(`create table public.proposals (id int)`);
  await db.exec(readScript('0057_geocode_cache_rollback.sql'));
  const left = (await db.query<{ n: number }>(`select count(*)::int as n from pg_proc where proname like 'geocode\\_%'`)).rows[0]!.n;
  const tables = (await db.query<{ n: number }>(`select count(*)::int as n from pg_tables where tablename like 'geocode\\_%'`)).rows[0]!.n;
  assertEquals([left, tables], [0, 0]);
  assertEquals((await db.query(`select * from public.proposals`)).rows.length, 0);
});
