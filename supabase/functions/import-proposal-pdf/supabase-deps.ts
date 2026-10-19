// Dependencias reales de import-proposal-pdf (supabase-js, Postgres de solo
// lectura y la API de OpenAI). La lógica vive en handler.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';
import { extractTrip } from './openai.ts';
import { claimedRowOrNull } from './claim.ts';
import type { RealDeps } from './db-lifecycle.ts';
import type { Deps, ImportRow } from './handler.ts';
import type { ProposalSnapshot } from '../_shared/proposal-diff.ts';

const BUCKET = 'proposal-imports';
const IMPORT_COLUMNS = 'id, proposal_id, file_path, mode, status, created_by';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export function createRealDeps(): RealDeps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = (token: string): SupabaseClient =>
    createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Conexión directa a Postgres, perezosa y una por solicitud (se cierra en db-lifecycle.ts).
  // prepare: false → también funciona si SUPABASE_DB_URL resultara ser el pooler en modo transacción.
  // Todas las consultas usan parámetros de la plantilla; nunca sql.unsafe.
  let sql: ReturnType<typeof postgres> | null = null;
  const db = () => {
    if (!sql) {
      const dbUrl = Deno.env.get('SUPABASE_DB_URL')!;
      // Solo el puerto (sin host ni credenciales): 5432 = conexión directa, 6543 = pooler en modo transacción.
      console.log(JSON.stringify({ msg: 'db.connect', port: new URL(dbUrl).port || '5432' }));
      sql = postgres(dbUrl, { max: 1, prepare: false, idle_timeout: 5 });
    }
    return sql;
  };
  const close = async () => {
    if (sql) {
      const current = sql;
      sql = null;
      await current.end({ timeout: 5 });
    }
  };

  const deps: Deps = {
    env: (name) => Deno.env.get(name),

    async getUser(token) {
      const { data, error } = await userClient(token).auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },

    async getImportAsUser(token, importId) {
      const { data } = await userClient(token).from('proposal_imports').select(IMPORT_COLUMNS).eq('id', importId).maybeSingle();
      return (data as ImportRow | null) ?? null;
    },

    async canEditProposal(token, proposalId) {
      const client = userClient(token);
      // Si RLS no devuelve la propuesta, el usuario ni siquiera puede verla.
      const { data: proposal } = await client.from('proposals').select('id, advisor_id').eq('id', proposalId).maybeSingle();
      if (!proposal) {
        return false;
      }
      const { data: canManage } = await client.rpc('can_manage_proposals');
      const { data: isOwn } = await client.rpc('is_own_or_full', { p_owner: proposal.advisor_id });
      return canManage === true && isOwn === true;
    },

    // El tiempo (ventana de 10 min) lo calcula la base con su propio reloj. Las funciones viven en el
    // schema `private`, que PostgREST no expone: se llaman por la conexión directa a Postgres.
    async countProcessing(userId) {
      const rows = await db()`select private.count_active_proposal_imports(${userId}::uuid) as n`;
      return Number(rows[0].n);
    },

    async countSince(userId, sinceIso) {
      const { count } = await admin
        .from('proposal_imports')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)
        .gte('created_at', sinceIso);
      return count ?? 0;
    },

    // Bloqueo atómico: UPDATE ... RETURNING dentro de private.claim_proposal_import (0050).
    // La función devuelve null si no pudo tomar la fila; processing_started_at se lee como texto para
    // conservar los microsegundos de la base (se usa como token al guardar el resultado).
    async lockImport(importId) {
      const rows = await db()`
        select r.id, r.proposal_id, r.file_path, r.mode, r.status, r.created_by,
               r.processing_started_at::text as processing_started_at
          from private.claim_proposal_import(${importId}::uuid) r`;
      // Sin bloqueo, la función devuelve UNA fila con todo en null (ver claim.ts).
      return claimedRowOrNull(rows);
    },

    // storage.objects tiene `owner_id` (texto, vigente) y `owner` (uuid, obsoleta).
    async objectOwner(path) {
      const rows = await db().begin('read only', (tx) =>
        tx`select owner_id, owner::text as owner from storage.objects where bucket_id = ${BUCKET} and name = ${path} limit 1`
      );
      if (rows.length === 0) {
        return null;
      }
      return { ownerId: (rows[0].owner_id as string | null) ?? (rows[0].owner as string | null) };
    },

    async download(path) {
      const { data, error } = await admin.storage.from(BUCKET).download(path);
      return error || !data ? null : new Uint8Array(await data.arrayBuffer());
    },

    async getProposalSnapshot(proposalId) {
      const { data } = await admin
        .from('proposals')
        .select('updated_at, client_name, client_email, client_phone, start_date, end_date, travelers_count, currency, pricing_total, content')
        .eq('id', proposalId)
        .maybeSingle();
      return (data as ProposalSnapshot | null) ?? null;
    },

    extract: ({ pdfBase64, apiKey, deadlineAt, ...provider }) =>
      extractTrip({ apiKey, deadlineAt, ...provider, log: (m, meta) => console.log(JSON.stringify({ msg: m, ...meta })) }, pdfBase64),

    // Solo escribe quien sigue siendo dueño del bloqueo (mismo processing_started_at, comparado con la
    // precisión completa de la base): un proceso viejo que termina tarde no pisa el resultado de quien
    // retomó la importación.
    async finishReady(row, patch) {
      const sql = db();
      await sql`
        update public.proposal_imports
           set status = 'ready',
               extracted = ${sql.json(patch.extracted as never)},
               diff = ${patch.diff ? sql.json(patch.diff as never) : null},
               error = null
         where id = ${row.id}::uuid
           and status = 'processing'
           and processing_started_at = ${row.processing_started_at!}::timestamptz`;
    },

    async finishFailed(row, message) {
      await db()`
        update public.proposal_imports
           set status = 'failed', error = ${message}
         where id = ${row.id}::uuid
           and status = 'processing'
           and processing_started_at = ${row.processing_started_at!}::timestamptz`;
    },

    runInBackground(task) {
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(task);
      }
    },

    now: () => new Date(),
    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };

  return { deps, close };
}
