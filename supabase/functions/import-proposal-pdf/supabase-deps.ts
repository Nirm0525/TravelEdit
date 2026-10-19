// Dependencias reales de import-proposal-pdf (supabase-js, Postgres de solo
// lectura y la API de Anthropic). La lógica vive en handler.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';
import { extractTrip } from './anthropic.ts';
import type { Deps, ImportRow } from './handler.ts';
import type { ProposalSnapshot } from '../_shared/proposal-diff.ts';

const BUCKET = 'proposal-imports';
const IMPORT_COLUMNS = 'id, proposal_id, file_path, mode, status, created_by';

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

export function createRealDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = (token: string): SupabaseClient =>
    createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  let sql: ReturnType<typeof postgres> | null = null;
  const db = () => (sql ??= postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false, idle_timeout: 5 }));

  return {
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

    async countProcessing(userId) {
      const { count } = await admin
        .from('proposal_imports')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)
        .eq('status', 'processing');
      return count ?? 0;
    },

    async countSince(userId, sinceIso) {
      const { count } = await admin
        .from('proposal_imports')
        .select('id', { count: 'exact', head: true })
        .eq('created_by', userId)
        .gte('created_at', sinceIso);
      return count ?? 0;
    },

    async lockImport(importId) {
      const { data } = await admin
        .from('proposal_imports')
        .update({ status: 'processing', error: null })
        .eq('id', importId)
        .in('status', ['uploaded', 'failed'])
        .select(IMPORT_COLUMNS)
        .maybeSingle();
      return (data as ImportRow | null) ?? null;
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

    extract: ({ pdfBase64, model, apiKey }) =>
      extractTrip({ apiKey, model, log: (m, meta) => console.log(JSON.stringify({ msg: m, ...meta })) }, pdfBase64),

    async finishReady(importId, patch) {
      await admin
        .from('proposal_imports')
        .update({ status: 'ready', extracted: patch.extracted, diff: patch.diff, error: null })
        .eq('id', importId)
        .eq('status', 'processing');
    },

    async finishFailed(importId, message) {
      await admin.from('proposal_imports').update({ status: 'failed', error: message }).eq('id', importId).eq('status', 'processing');
    },

    runInBackground(task) {
      if (typeof EdgeRuntime !== 'undefined') {
        EdgeRuntime.waitUntil(task);
      }
    },

    now: () => new Date(),
    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };
}
