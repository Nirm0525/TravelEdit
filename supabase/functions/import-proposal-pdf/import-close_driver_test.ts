// Regresión con el driver REAL (postgres.js, el mismo que usa la función) contra un Postgres en memoria
// (PGlite) expuesto por socket. Un doble no sirve aquí: el bug estaba en cómo postgres.js serializa un
// parámetro timestamptz (lo pasa por Date y recorta los microsegundos), y un adaptador lo esconde.
//
// El token usa microsegundos EXPLÍCITOS: el now() de PGlite solo da milisegundos y no reproduciría el fallo.
import { PGlite } from 'npm:@electric-sql/pglite@0.5.10';
import { PGLiteSocketServer } from 'npm:@electric-sql/pglite-socket@0.2.13';
import postgres from 'npm:postgres@3';
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { closeImportFailed, closeImportReady, ImportCloseConflictError, type CloseSql } from './import-close.ts';
import type { ImportRow } from './handler.ts';
import type { StoredExtraction } from '../_shared/proposal-extraction.ts';
import { matchingExtraction } from '../_shared/test-fixtures.ts';

const ID = '11111111-1111-1111-1111-111111111111';
const USER = '22222222-2222-2222-2222-222222222222';
/** Valor real visto en producción: 6 decimales. */
const STORED_TOKEN = '2026-10-19 19:58:21.166059+00';

function freePort(): number {
  const listener = Deno.listen({ port: 0, hostname: '127.0.0.1' });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

interface Env {
  sql: ReturnType<typeof postgres>;
  /** Lo que usa la función: el mismo objeto, con la forma mínima de import-close.ts. */
  closeSql: CloseSql;
  /** Lo que devolvería lockImport: el token leído de la base como texto (r.processing_started_at::text). */
  claimedRow(): Promise<ImportRow>;
  state(): Promise<{ status: string; error: string | null; extracted: unknown; diff: unknown; token: string }>;
  setToken(token: string, status?: string): Promise<void>;
}

async function withDb(fn: (env: Env) => Promise<void>): Promise<void> {
  const db = new PGlite();
  await db.exec(`
    create table public.proposal_imports (
      id uuid primary key, status text not null default 'uploaded', extracted jsonb, diff jsonb, error text,
      processing_started_at timestamptz);
    insert into public.proposal_imports (id, status, processing_started_at) values ('${ID}', 'processing', '${STORED_TOKEN}');`);
  const port = freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  // Mismas opciones que supabase-deps.ts.
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1, prepare: false, idle_timeout: 5 });
  try {
    await fn({
      sql,
      closeSql: sql as unknown as CloseSql,
      claimedRow: async () => {
        const rows = await sql`select id, status, processing_started_at::text as processing_started_at from public.proposal_imports where id = ${ID}::uuid`;
        return { ...rows[0], proposal_id: null, file_path: 'u/f.pdf', mode: 'new', created_by: USER } as unknown as ImportRow;
      },
      state: async () => {
        const rows = await sql`select status, error, extracted, diff, processing_started_at::text as token from public.proposal_imports where id = ${ID}::uuid`;
        return rows[0] as never;
      },
      setToken: async (token, status = 'processing') => {
        await sql`update public.proposal_imports set processing_started_at = ${token}::text::timestamptz, status = ${status}, error = null, extracted = null where id = ${ID}::uuid`;
      }
    });
  } finally {
    await sql.end({ timeout: 2 });
    await server.stop();
    await db.close();
  }
}

const stored = (): StoredExtraction =>
  ({ ...matchingExtraction(), warnings: [], meta: { model: 'gpt-6.1-sol', extracted_at: '2027-01-01T00:00:00Z' } }) as unknown as StoredExtraction;

// El postgres.js que corre en PGlite devuelve el token con el offset del servidor; lo que importa es que conserve 6 decimales.
const microseconds = (token: string) => /\.\d{6}(?!\d)/.test(token);

Deno.test('driver real: la base conserva los microsegundos y lockImport los lee como texto', async () => {
  await withDb(async (env) => {
    const row = await env.claimedRow();
    assert(microseconds(row.processing_started_at!), `esperaba 6 decimales: ${row.processing_started_at}`);
  });
});

Deno.test('driver real: el patrón VIEJO (${token}::timestamptz) pierde los microsegundos y no encuentra la fila', async () => {
  await withDb(async (env) => {
    const { processing_started_at: token } = await env.claimedRow();
    const old = await env.sql`
      update public.proposal_imports set status = 'failed'
       where id = ${ID}::uuid and status = 'processing' and processing_started_at = ${token!}::timestamptz`;
    assertEquals(old.count, 0);
    assertEquals((await env.state()).status, 'processing'); // la fila sigue ahí, intacta
  });
});

Deno.test('driver real: el patrón NUEVO (${token}::text::timestamptz) afecta exactamente 1 fila', async () => {
  await withDb(async (env) => {
    const { processing_started_at: token } = await env.claimedRow();
    const fixed = await env.sql`
      update public.proposal_imports set status = 'failed'
       where id = ${ID}::uuid and status = 'processing' and processing_started_at = ${token!}::text::timestamptz`;
    assertEquals(fixed.count, 1);
  });
});

Deno.test('driver real: finishReady cierra processing → ready con el token exacto (1 fila) y guarda extracted', async () => {
  await withDb(async (env) => {
    const row = await env.claimedRow();
    await closeImportReady(env.closeSql, row, { extracted: stored(), diff: null });
    const state = await env.state();
    assertEquals(state.status, 'ready');
    assertEquals(state.error, null);
    assertEquals(state.diff, null);
    assertEquals((state.extracted as StoredExtraction).meta.model, 'gpt-6.1-sol');
    assertEquals((state.extracted as StoredExtraction).client.name, stored().client.name);
  });
});

Deno.test('driver real: finishReady con un token distinto (otro proceso) lanza, afecta 0 filas y no pisa nada', async () => {
  await withDb(async (env) => {
    const row = await env.claimedRow();
    // Un proceso nuevo retomó la importación: mismo segundo, microsegundos distintos.
    await env.setToken('2026-10-19 19:58:21.166060+00');
    const before = await env.state();
    const err = await assertRejects(() => closeImportReady(env.closeSql, row, { extracted: stored(), diff: null }), ImportCloseConflictError);
    assertEquals([err.operation, err.rowsAffected, err.importId], ['finishReady', 0, ID]);
    assertEquals(await env.state(), before); // sigue en processing, sin extracted, con el token del proceso nuevo
    assertEquals((await env.state()).extracted, null);
  });
});

Deno.test('driver real: finishFailed cierra processing → failed con el token exacto (1 fila) y guarda el mensaje', async () => {
  await withDb(async (env) => {
    const row = await env.claimedRow();
    await closeImportFailed(env.closeSql, row, 'No se pudo procesar el PDF. Inténtalo de nuevo en unos minutos.');
    const state = await env.state();
    assertEquals(state.status, 'failed');
    assertEquals(state.error, 'No se pudo procesar el PDF. Inténtalo de nuevo en unos minutos.');
  });
});

Deno.test('driver real: finishFailed con un token viejo o ajeno lanza y no modifica al proceso nuevo', async () => {
  await withDb(async (env) => {
    const oldRow = await env.claimedRow();
    await env.setToken('2026-10-19 20:10:00.000001+00'); // la retomó otro proceso, minutos después
    const before = await env.state();
    const err = await assertRejects(() => closeImportFailed(env.closeSql, oldRow, 'mensaje'), ImportCloseConflictError);
    assertEquals([err.operation, err.rowsAffected], ['finishFailed', 0]);
    assertEquals(await env.state(), before);
  });
});

Deno.test('driver real: si la fila ya no está en processing, el cierre lanza (no se reabre ni se pisa)', async () => {
  await withDb(async (env) => {
    const row = await env.claimedRow();
    await env.setToken(row.processing_started_at!, 'ready');
    await assertRejects(() => closeImportFailed(env.closeSql, row, 'mensaje'), ImportCloseConflictError);
    await assertRejects(() => closeImportReady(env.closeSql, row, { extracted: stored(), diff: null }), ImportCloseConflictError);
    assertEquals((await env.state()).status, 'ready');
  });
});

Deno.test('driver real: token con microsegundos terminados en 000 (coincide aun con el patrón viejo) también cierra con el nuevo', async () => {
  await withDb(async (env) => {
    await env.setToken('2026-10-19 19:58:21.166000+00');
    await closeImportFailed(env.closeSql, await env.claimedRow(), 'mensaje');
    assertEquals((await env.state()).status, 'failed');
  });
});
