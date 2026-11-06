// Dependencias reales de geocode-place. El JWT de la asesora solo se usa para identificarla y preguntar can_manage_proposals();
// la caché y el turno global viven en funciones que SOLO ejecuta service_role (migración 0057).
import { createClient } from 'npm:@supabase/supabase-js@2';
import type { ClaimState, Deps } from './handler.ts';

export function createRealDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const callerClient = (token: string) =>
    createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } }
    });

  const rpc = async <T>(name: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await admin.rpc(name, args);
    if (error) {
      throw new Error(`${name}: ${error.code ?? 'error'}`);
    }
    return data as T;
  };

  return {
    env: (name) => Deno.env.get(name),

    async authenticate(token) {
      const { data, error } = await callerClient(token).auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },

    async canManageProposals(token) {
      const { data, error } = await callerClient(token).rpc('can_manage_proposals');
      return !error && data === true;
    },

    async claim(provider, key, query, leaseSeconds) {
      const rows = await rpc<{ state: ClaimState; results: unknown }[]>('geocode_claim', {
        p_provider: provider,
        p_key: key,
        p_query: query,
        p_lease_seconds: leaseSeconds
      });
      const row = rows[0];
      return { state: row?.state ?? 'wait', results: row?.results ?? null };
    },

    async store(provider, key, results, ttlSeconds) {
      await rpc('geocode_store', { p_provider: provider, p_key: key, p_results: results, p_ttl_seconds: ttlSeconds });
    },

    async release(provider, key) {
      await rpc('geocode_release', { p_provider: provider, p_key: key });
    },

    async reserveSlot(provider, intervalMs, maxWaitMs) {
      return await rpc<number>('geocode_reserve_slot', { p_provider: provider, p_interval_ms: intervalMs, p_max_wait_ms: maxWaitMs });
    },

    async quota(scope, limit, take) {
      const rows = await rpc<{ allowed: boolean; used: number; resets_in_seconds: number }[]>('geocode_quota_take', {
        p_scope: scope,
        p_limit: limit,
        p_take: take
      });
      const row = rows[0];
      // Sin respuesta de la base se falla CERRADO (used = -1): no se llama al proveedor.
      return { allowed: !!row?.allowed, used: row?.used ?? -1, resetsInSeconds: row?.resets_in_seconds ?? 60 };
    },

    async backoff(provider, seconds) {
      await rpc('geocode_backoff', { p_provider: provider, p_seconds: seconds });
    },

    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    // Nunca el texto buscado ni datos del cliente: solo códigos y duraciones.
    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };
}
