// Dependencias reales de apply-proposal-import (supabase-js para lo que decide RLS, Postgres directo
// para la transacción). La lógica vive en handler.ts y tx.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import postgres from 'npm:postgres@3';
import type { Deps, ImportRow } from './handler.ts';
import { applyImportTx, type SqlLike } from './tx.ts';

const BUCKET = 'proposal-imports';

export interface RealDeps {
  deps: Deps;
  /** Cierra la conexión directa a Postgres (idempotente). */
  close(): Promise<void>;
}

export function createRealDeps(): RealDeps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = (token: string): SupabaseClient =>
    createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Conexión directa, perezosa y una por solicitud. prepare: false por si SUPABASE_DB_URL es el pooler.
  let sql: ReturnType<typeof postgres> | null = null;
  const db = () => (sql ??= postgres(Deno.env.get('SUPABASE_DB_URL')!, { max: 1, prepare: false, idle_timeout: 5 }));
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
      const { data } = await userClient(token)
        .from('proposal_imports')
        .select('id, mode, kind, status, file_path, created_by, extracted')
        .eq('id', importId)
        .maybeSingle();
      return (data as ImportRow | null) ?? null;
    },

    async canTravel(token, kind, action) {
      const { data } = await userClient(token).rpc('can_travel', { p_kind: kind, p_action: action });
      return data === true;
    },

    async canSeeLead(token, leadId) {
      const { data } = await userClient(token).from('leads').select('id').eq('id', leadId).maybeSingle();
      return !!data;
    },

    applyImport: (args) => applyImportTx(db() as unknown as SqlLike, args),

    async deleteFile(path) {
      const { error } = await admin.storage.from(BUCKET).remove([path]);
      if (error) {
        throw new Error(error.message);
      }
    },

    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };

  return { deps, close };
}
