// Dependencias de geocode-place sobre una conexión REAL de PostgreSQL (npm:pg). SOLO para pruebas de integración
// (postgres_concurrency_test.ts y el proceso hijo pg_instance_child.ts): la función desplegada usa supabase-deps.ts (PostgREST).
// Ejecutan exactamente las mismas funciones SQL de la migración 0057, con el rol service_role.
// @ts-types="npm:@types/pg@8"
import pg from 'npm:pg@8';
import type { ClaimState, Deps } from './handler.ts';

export type PgClient = InstanceType<typeof pg.Client>;

/** Una «instancia» = una conexión independiente (proceso de backend propio en PostgreSQL) con el rol indicado. */
export async function connectAs(url: string, role = 'service_role'): Promise<PgClient> {
  const client = new pg.Client({ connectionString: url });
  // Una conexión terminada a propósito (pg_terminate_backend) emite 'error': no debe tumbar el proceso de prueba.
  client.on('error', () => undefined);
  await client.connect();
  if (role !== 'postgres') {
    await client.query(`set role ${role}`);
  }
  return client;
}

export interface PgDepsOptions {
  env?: Record<string, string>;
  fetch?: typeof fetch;
  log?: (message: string, meta?: Record<string, unknown>) => void;
}

export function pgDeps(client: PgClient, options: PgDepsOptions = {}): Deps {
  // Las pruebas de integración heredadas simulan Nominatim; las de Geoapify eligen su proveedor y su clave explícitamente.
  const env: Record<string, string> = { GEOCODER_PROVIDER: 'nominatim', ...(options.env ?? {}) };
  return {
    env: (name) => env[name],
    authenticate: () => Promise.resolve({ id: 'u1' }),
    canManageProposals: () => Promise.resolve(true),
    async claim(provider, key, query, leaseSeconds) {
      const r = await client.query<{ state: ClaimState; results: unknown }>('select state, results from public.geocode_claim($1, $2, $3, $4)', [provider, key, query, leaseSeconds]);
      return { state: r.rows[0]!.state, results: r.rows[0]!.results };
    },
    async store(provider, key, results, ttlSeconds) {
      await client.query('select public.geocode_store($1, $2, $3::jsonb, $4)', [provider, key, JSON.stringify(results), ttlSeconds]);
    },
    async release(provider, key) {
      await client.query('select public.geocode_release($1, $2)', [provider, key]);
    },
    async reserveSlot(provider, intervalMs, maxWaitMs) {
      const r = await client.query<{ w: number }>('select public.geocode_reserve_slot($1, $2, $3) as w', [provider, intervalMs, maxWaitMs]);
      return r.rows[0]!.w;
    },
    async quota(scope, limit, take) {
      const r = await client.query<{ allowed: boolean; used: number; resets_in_seconds: number }>(
        'select allowed, used, resets_in_seconds from public.geocode_quota_take($1, $2, $3)',
        [scope, limit, take]
      );
      const row = r.rows[0];
      return { allowed: !!row?.allowed, used: row?.used ?? -1, resetsInSeconds: row?.resets_in_seconds ?? 60 };
    },
    async backoff(provider, seconds) {
      await client.query('select public.geocode_backoff($1, $2)', [provider, seconds]);
    },
    fetch: options.fetch ?? ((input, init) => fetch(input, init)),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    log: options.log ?? (() => undefined)
  };
}

/** Respuesta canónica de Geoapify (format=json) para las pruebas: nunca se consulta al proveedor real. */
export function fakeGeoapifyBody(seed: string): string {
  return JSON.stringify({
    results: [
      {
        datasource: { sourcename: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License', url: 'https://www.openstreetmap.org/copyright' },
        name: `Lugar ${seed}`,
        lon: -9.216,
        lat: 38.6916,
        formatted: `Lugar ${seed}, Lisboa, Portugal`,
        address_line1: `Lugar ${seed}`,
        address_line2: 'Lisboa, Portugal',
        result_type: 'amenity',
        place_id: `place-${seed.length}-${seed.charCodeAt(0)}`,
        bbox: { lon1: -9.2164, lat1: 38.6912, lon2: -9.2156, lat2: 38.692 }
      }
    ],
    query: { text: seed }
  });
}

/** Respuesta canónica de Nominatim (jsonv2) para las pruebas: nunca se consulta al proveedor real. */
export function fakeNominatimBody(seed: string): string {
  return JSON.stringify([
    {
      osm_type: 'way',
      osm_id: 1000 + (seed.length % 900),
      lat: '38.6916',
      lon: '-9.2160',
      name: `Lugar ${seed}`,
      display_name: `Lugar ${seed}, Lisboa, Portugal`,
      boundingbox: ['38.6912', '38.6920', '-9.2164', '-9.2156']
    }
  ]);
}
