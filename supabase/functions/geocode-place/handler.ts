// Búsqueda de ubicaciones para días y servicios — lógica separada de Deno.serve y supabase-js (se prueba sin red ni base).
//
// Entrada: POST { query: string, mode?: 'search' | 'autocomplete', bias?: { lat, lon } } con el JWT de la asesora.
//  - mode «search» (predeterminado, botón «Buscar ubicación»): endpoint de búsqueda, mínimo 3 caracteres, hasta 3 candidatos.
//  - mode «autocomplete» (sugerencias al escribir): endpoint oficial de autocompletado de Geoapify, mínimo 4 caracteres, hasta 5 sugerencias
//    con sus coordenadas (elegir una NO requiere otra llamada). `bias` es una preferencia de proximidad (nunca un filtro por país).
//    Mismo JWT, mismos permisos, misma caché (otra familia de claves), mismo turno global y MISMA cuota diaria que la búsqueda.
// Salida: hasta 3 (o 5) candidatos { provider, geocoder, placeId, osmType, osmId,
// name, address, lat, lon, bbox, dataSource, attribution, license } del proveedor configurado (Geoapify por defecto) y la atribución
// obligatoria. NO guarda nada en propuestas: la asesora elige un candidato en el editor y lo guarda por la cola de guardado habitual.
//
// Autorización: sesión válida (auth.getUser) + can_manage_proposals() — la misma regla que proposal-ai-polish.
//
// Política del proveedor (ver geocoder.ts, geoapify.ts, nominatim.ts):
//  - Caché persistente (tabla private.geocode_cache) por consulta normalizada; las consultas sin resultados también se cachean (TTL corto).
//  - Límite global de 1 consulta/s entre TODAS las instancias: cada consulta reserva un turno en la base (geocode_reserve_slot).
//  - Consultas idénticas simultáneas: una sola va al proveedor (un mapa en memoria dentro de la instancia + una reserva «pending»
//    en la base entre instancias); las demás esperan el resultado de la caché.
//  - Timeout, UNA sola consulta por petición (sin reintentos) y, ante 429/403/503 del proveedor, una pausa global (geocode_backoff).
//  - Límite DIARIO persistente y atómico de llamadas externas (geocode_quota_take, migración 0058): cada intento externo cuenta, incluidos
//    los errores; los aciertos de caché no consumen. Al agotarse se sirven las ubicaciones cacheadas y las búsquedas nuevas reciben
//    «quota_exhausted» SIN llamar al proveedor.
//  - Los errores nunca se cachean. Ni el texto buscado ni la clave de API se registran jamás en logs.
import { corsHeadersFor } from '../_shared/cors.ts';
import {
  ATTRIBUTION,
  cacheKey,
  cacheScope,
  MAX_QUERY_LENGTH,
  MIN_QUERY_LENGTH,
  MIN_SUGGEST_LENGTH,
  maxResultsFor,
  roundBias,
  missingApiKey,
  normalizeQuery,
  parseCachedCandidates,
  readGeocoderConfig,
  redactSecrets,
  type GeocodeCandidate,
  type GeocoderConfig,
  type SearchBias,
  type SearchMode,
  type SearchOutcome,
  type SearchRequest
} from './geocoder.ts';
import { searchGeoapify } from './geoapify.ts';
import { searchNominatim } from './nominatim.ts';

export type ClaimState = 'hit' | 'claimed' | 'wait';

export interface Deps {
  env(name: string): string | undefined;
  /** Usuario de la sesión (auth.getUser con el JWT), o null si no es válida. */
  authenticate(token: string): Promise<{ id: string } | null>;
  /** can_manage_proposals() ejecutada con el JWT de quien llama. */
  canManageProposals(token: string): Promise<boolean>;
  claim(provider: string, key: string, query: string, leaseSeconds: number): Promise<{ state: ClaimState; results: unknown }>;
  store(provider: string, key: string, results: unknown[], ttlSeconds: number): Promise<void>;
  release(provider: string, key: string): Promise<void>;
  /** Milisegundos a esperar antes de consultar al proveedor, o -1 si la espera superaría maxWaitMs. */
  reserveSlot(provider: string, intervalMs: number, maxWaitMs: number): Promise<number>;
  backoff(provider: string, seconds: number): Promise<void>;
  /**
   * Límite diario de llamadas externas (geocode_quota_take). take = false solo informa; take = true consume UNA llamada de forma atómica
   * (nunca supera el límite). used = -1 si la base no pudo responder (se falla cerrado: no se llama al proveedor).
   */
  quota(scope: string, limit: number, take: boolean): Promise<{ allowed: boolean; used: number; resetsInSeconds: number }>;
  fetch: typeof fetch;
  sleep(ms: number): Promise<void>;
  now(): number;
  log(message: string, meta?: Record<string, unknown>): void;
}

/** Proveedores implementados. Añadir otro = nuevo adaptador aquí + su entrada en PROVIDERS (geocoder.ts). */
const SEARCH_BY_PROVIDER: Record<string, (config: GeocoderConfig, request: SearchRequest, fetchImpl: typeof fetch) => Promise<SearchOutcome>> = {
  geoapify: searchGeoapify,
  nominatim: (config, request, fetchImpl) => searchNominatim(config, request.query, fetchImpl)
};
/** Proveedores con autocompletado. Nominatim NO: su política de uso público lo prohíbe (y no hay respaldo automático entre proveedores). */
const AUTOCOMPLETE_PROVIDERS = new Set(['geoapify']);

const MAX_SLOT_WAIT_MS = 4_000;
/** Las sugerencias envejecen rápido: esperan menos turno que una búsqueda explícita (si no cabe, «busy» y la asesora sigue escribiendo). */
const MAX_SLOT_WAIT_AUTOCOMPLETE_MS = 1_500;
/** Margen sobre el máximo que puede tardar legítimamente quien tiene la reserva (turno + proveedor). */
const LEASE_MARGIN_SECONDS = 5;
const REQUEST_MARGIN_MS = 3_000;
const WAIT_FOR_OTHER_MS = 9_000;
const POLL_MS = 400;
/**
 * geocode_backoff (SQL ya aplicada) topa su pausa en 1 h, pero un Retry-After mayor se respeta ENTERO: la pausa completa se guarda como
 * un marcador en la caché (TTL admite hasta 1 año) y se consulta antes de cada consulta al proveedor. Pasada 1 h NO se vuelve a consultar.
 */
const SQL_BACKOFF_CAP_SECONDS = 3600;
const MAX_PAUSE_SECONDS = 31_536_000;
/** Clave reservada del marcador de pausa del proveedor (las claves de consulta empiezan siempre por «v1|»). */
const PAUSE_KEY = '!provider-pause';
const PAUSE_ERROR_STATUS: Record<string, number> = { provider_limited: 429, provider_blocked: 502, provider_unavailable: 502 };

interface PauseMarker {
  /** Instante (ms desde epoch) hasta el que no se consulta al proveedor. */
  until: number;
  error: string;
  providerStatus: number;
  source: 'provider' | 'default';
}
/** Pausa cuando el proveedor NO dice cuánto esperar, según su respuesta. Una pausa por defecto nunca se presenta como si la hubiera pedido él. */
const DEFAULT_BACKOFF_BY_STATUS: Record<number, number> = { 429: 120, 403: 300, 401: 600, 402: 3600, 503: 60 };
const DEFAULT_BACKOFF_SECONDS = 120;

type Outcome =
  | { ok: true; results: GeocodeCandidate[]; cached: boolean }
  | {
      ok: false;
      error: string;
      status: number;
      retryAfterSeconds?: number;
      /** Estado HTTP real que devolvió el proveedor (solo si fue él quien rechazó). */
      providerStatus?: number;
      /** 'provider' = el proveedor pidió esperar (Retry-After); 'default' = pausa nuestra porque no dijo cuánto. */
      retryAfterSource?: 'provider' | 'default';
      /** Límite diario configurado (solo en quota_exhausted). */
      dailyLimit?: number;
    };

const busy = (retryAfterSeconds: number): Outcome => ({ ok: false, error: 'busy', status: 429, retryAfterSeconds });

/** Consultas en curso en ESTA instancia: las idénticas simultáneas comparten una sola búsqueda. */
const inflight = new Map<string, Promise<Outcome>>();
export function resetInflight(): void {
  inflight.clear();
}

/**
 * Lease de la reserva: lo máximo que puede tardar quien la tiene (turno + proveedor) más un margen. Si esa instancia muere, la
 * reserva vence sola en ese tiempo y la siguiente petición la reclama.
 */
const leaseSeconds = (config: GeocoderConfig) => Math.ceil((MAX_SLOT_WAIT_MS + config.timeoutMs) / 1000) + LEASE_MARGIN_SECONDS;

/** Límite diario agotado: se informa cuándo se renueva (00:00 UTC) y NO se llama al proveedor. */
function quotaExhausted(config: GeocoderConfig, resetsInSeconds: number): Outcome {
  return { ok: false, error: 'quota_exhausted', status: 429, retryAfterSeconds: Math.max(1, resetsInSeconds), retryAfterSource: 'default', dailyLimit: config.dailyLimit };
}

/** ¿Hay una pausa vigente del proveedor (la que pidió él, entera)? Si la hay devuelve la respuesta a dar, SIN consultarle. */
async function readPause(deps: Deps, scope: string): Promise<Outcome | null> {
  const claim = await deps.claim(scope, PAUSE_KEY, 'pausa del proveedor', 5);
  if (claim.state === 'claimed') {
    await deps.release(scope, PAUSE_KEY).catch(() => undefined); // no había marcador: se libera la reserva de comprobación
    return null;
  }
  const marker = claim.state === 'hit' && Array.isArray(claim.results) ? (claim.results[0] as Partial<PauseMarker> | undefined) : undefined;
  if (!marker || typeof marker.until !== 'number' || typeof marker.error !== 'string' || typeof marker.providerStatus !== 'number') {
    return null;
  }
  const remaining = Math.ceil((marker.until - deps.now()) / 1000);
  if (remaining <= 0) {
    return null;
  }
  return {
    ok: false,
    error: marker.error,
    status: PAUSE_ERROR_STATUS[marker.error] ?? 502,
    retryAfterSeconds: remaining,
    providerStatus: marker.providerStatus,
    retryAfterSource: marker.source === 'provider' ? 'provider' : 'default'
  };
}

async function writePause(deps: Deps, scope: string, seconds: number, marker: Omit<PauseMarker, 'until'>): Promise<void> {
  const claim = await deps.claim(scope, PAUSE_KEY, 'pausa del proveedor', 5);
  if (claim.state === 'claimed') {
    await deps.store(scope, PAUSE_KEY, [{ ...marker, until: deps.now() + seconds * 1000 }], seconds);
  }
}

async function fetchAndStore(deps: Deps, config: GeocoderConfig, scope: string, key: string, request: SearchRequest): Promise<Outcome> {
  let stored = false;
  try {
    const paused = await readPause(deps, scope);
    if (paused) {
      return paused;
    }
    // Límite diario: si ya se agotó no se espera turno ni se llama al proveedor (las ubicaciones cacheadas se sirven antes, en lookup).
    const before = await deps.quota(scope, config.dailyLimit, false);
    if (before.used < 0) {
      return busy(3);
    }
    if (!before.allowed) {
      return quotaExhausted(config, before.resetsInSeconds);
    }
    const wait = await deps.reserveSlot(scope, config.minIntervalMs, request.mode === 'autocomplete' ? MAX_SLOT_WAIT_AUTOCOMPLETE_MS : MAX_SLOT_WAIT_MS);
    if (wait < 0) {
      return busy(Math.ceil(config.minIntervalMs / 1000) + 2);
    }
    if (wait > 0) {
      await deps.sleep(wait);
    }
    // Cada INTENTO externo cuenta (incluidos los que acaban en error o timeout): se consume aquí, de forma atómica, justo antes de llamar.
    const taken = await deps.quota(scope, config.dailyLimit, true);
    if (taken.used < 0) {
      return busy(3);
    }
    if (!taken.allowed) {
      return quotaExhausted(config, taken.resetsInSeconds);
    }
    const search = SEARCH_BY_PROVIDER[config.provider]!;
    const started = deps.now();
    const outcome = await search(config, request, deps.fetch);
    // Registra lo que respondió el proveedor (estado, Retry-After y un extracto de su mensaje) y el User-Agent enviado; nunca la consulta.
    deps.log('geocode.provider', {
      provider: config.provider,
      mode: request.mode,
      kind: outcome.kind,
      ms: deps.now() - started,
      used: taken.used,
      ...(outcome.kind === 'ok'
        ? { results: outcome.results.length }
        : { status: outcome.status, retryAfter: outcome.retryAfterHeader, hint: redactSecrets(outcome.bodyHint, config.apiKey), userAgent: config.userAgent })
    });

    if (outcome.kind === 'ok') {
      await deps.store(scope, key, outcome.results, outcome.results.length > 0 ? config.cacheTtlSeconds : config.emptyTtlSeconds);
      stored = true;
      return { ok: true, results: outcome.results, cached: false };
    }

    // 429 / 403 / 503: pausa global para todas las instancias. Se respeta Retry-After ENTERO (sin tope de 1 h; solo el máximo de la caché,
    // 1 año); sin él, una pausa por defecto según el estado.
    const fromProvider = outcome.kind === 'limited' && outcome.retryAfterSeconds !== null;
    const seconds = Math.min(
      MAX_PAUSE_SECONDS,
      outcome.retryAfterSeconds ?? (outcome.kind === 'limited' ? (DEFAULT_BACKOFF_BY_STATUS[outcome.status] ?? DEFAULT_BACKOFF_SECONDS) : 0)
    );
    // 429 = límite; 403/401/402 = acceso, clave o plan rechazados (sin afirmar la causa); el resto = no disponible.
    const error =
      outcome.kind === 'limited' && outcome.status === 429
        ? 'provider_limited'
        : outcome.kind === 'limited' && [401, 402, 403].includes(outcome.status)
          ? 'provider_blocked'
          : 'provider_unavailable';
    const source = fromProvider ? ('provider' as const) : ('default' as const);
    if (outcome.kind === 'limited') {
      await deps.backoff(scope, Math.min(seconds, SQL_BACKOFF_CAP_SECONDS));
      await writePause(deps, scope, seconds, { error, providerStatus: outcome.status, source });
    }
    // 403 = el proveedor rechazó la solicitud. El estado no dice por qué (la política de OSM lo atribuye a incumplir su política de uso):
    // no se afirma ninguna causa; el motivo real está en el cuerpo de su respuesta (log geocode.provider, campo «hint»).
    return {
      ok: false,
      error,
      status: PAUSE_ERROR_STATUS[error]!,
      providerStatus: outcome.status,
      ...(outcome.kind === 'limited' ? { retryAfterSeconds: seconds, retryAfterSource: source } : {})
    };
  } catch (error) {
    const name = (error as Error | null)?.name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      return { ok: false, error: 'timeout', status: 504 };
    }
    deps.log('geocode.error', { name });
    return { ok: false, error: error instanceof TypeError ? 'provider_unavailable' : 'unexpected_error', status: error instanceof TypeError ? 502 : 500 };
  } finally {
    if (!stored) {
      await deps.release(scope, key).catch(() => undefined);
    }
  }
}

async function lookup(deps: Deps, config: GeocoderConfig, scope: string, key: string, request: SearchRequest): Promise<Outcome> {
  const deadline = deps.now() + WAIT_FOR_OTHER_MS;
  for (;;) {
    const claim = await deps.claim(scope, key, request.query, leaseSeconds(config));
    if (claim.state === 'hit') {
      return { ok: true, results: parseCachedCandidates(claim.results, maxResultsFor(request.mode)), cached: true };
    }
    if (claim.state === 'claimed') {
      return await fetchAndStore(deps, config, scope, key, request);
    }
    // Otra instancia la está consultando: esperar su resultado en la caché (sin consultar al proveedor).
    if (deps.now() >= deadline) {
      return busy(3);
    }
    await deps.sleep(POLL_MS);
  }
}

/** Plazo total de la petición: si algo (base de datos, proveedor) no responde, se contesta 504 en vez de quedar colgada. */
async function withDeadline(work: Promise<Outcome>, ms: number): Promise<Outcome> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Outcome>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, error: 'timeout', status: 504 }), ms);
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

/** Preferencia de proximidad válida ({lat, lon} numéricos en rango) redondeada a 0,1°; null si falta o no es válida. */
function readBias(value: unknown): SearchBias | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const { lat, lon } = value as { lat?: unknown; lon?: unknown };
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return null;
  }
  return roundBias(lat, lon);
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeadersFor(req, deps.env('ALLOWED_ORIGINS'));
  const json = (body: unknown, status: number, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, ...extra, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  const fail = (error: string, status: number, retryAfterSeconds?: number, extra: Record<string, unknown> = {}) =>
    json({ success: false, error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}), ...extra }, status, retryAfterSeconds ? { 'Retry-After': String(retryAfterSeconds) } : {});

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return fail('method_not_allowed', 405);
  }

  try {
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.replace(/^Bearer\s+/i, '').trim() : '';
    if (!token) {
      return fail('unauthorized', 401);
    }
    if (!(await deps.authenticate(token))) {
      return fail('unauthorized', 401);
    }
    if (!(await deps.canManageProposals(token))) {
      return fail('forbidden', 403);
    }

    const body = (await req.json().catch(() => null)) as { query?: unknown; mode?: unknown; bias?: unknown } | null;
    if (body?.mode !== undefined && body.mode !== 'search' && body.mode !== 'autocomplete') {
      return fail('invalid_mode', 400);
    }
    const mode: SearchMode = body?.mode === 'autocomplete' ? 'autocomplete' : 'search';
    const normalized = typeof body?.query === 'string' ? normalizeQuery(body.query) : '';
    if (normalized.length < (mode === 'autocomplete' ? MIN_SUGGEST_LENGTH : MIN_QUERY_LENGTH)) {
      return fail('invalid_query', 400);
    }
    if (normalized.length > MAX_QUERY_LENGTH) {
      return fail('query_too_long', 400);
    }

    const config = readGeocoderConfig(deps.env);
    if (!config || !SEARCH_BY_PROVIDER[config.provider] || missingApiKey(config)) {
      // Nunca se registra la clave; solo el proveedor y si falta.
      deps.log('geocode.not_configured', { provider: config?.provider ?? deps.env('GEOCODER_PROVIDER') ?? 'geoapify', missingKey: !!config && missingApiKey(config) });
      return fail('provider_not_configured', 503);
    }

    if (mode === 'autocomplete' && !AUTOCOMPLETE_PROVIDERS.has(config.provider)) {
      return fail('autocomplete_unsupported', 400);
    }
    // La preferencia geográfica solo cuenta en autocompletado y solo si son coordenadas válidas (si no, se ignora, nunca se inventa).
    const bias = mode === 'autocomplete' ? readBias(body?.bias) : null;
    const request: SearchRequest = { mode, query: normalized, bias };

    // Ámbito = proveedor + endpoint (compartido por búsqueda y autocompletado: MISMO turno global y MISMA cuota diaria);
    // clave = modo + límite + idioma + preferencia + consulta: cambiar cualquiera NUNCA reutiliza caché ajena.
    const scope = cacheScope(config);
    const key = cacheKey(config, normalized, { mode, bias });
    const flightKey = `${scope}|${key}`;
    let pending = inflight.get(flightKey);
    if (!pending) {
      pending = lookup(deps, config, scope, key, request).finally(() => inflight.delete(flightKey));
      inflight.set(flightKey, pending);
    }
    const outcome = await withDeadline(pending, WAIT_FOR_OTHER_MS + MAX_SLOT_WAIT_MS + config.timeoutMs + REQUEST_MARGIN_MS);
    if (!outcome.ok) {
      return fail(outcome.error, outcome.status, outcome.retryAfterSeconds, {
        ...(outcome.providerStatus ? { providerStatus: outcome.providerStatus } : {}),
        ...(outcome.retryAfterSource ? { retryAfterSource: outcome.retryAfterSource } : {}),
        ...(outcome.dailyLimit ? { dailyLimit: outcome.dailyLimit } : {})
      });
    }
    return json({ success: true, results: outcome.results, cached: outcome.cached, attribution: ATTRIBUTION }, 200);
  } catch (error) {
    deps.log('geocode.unexpected', { name: (error as Error | null)?.name });
    return fail('unexpected_error', 500);
  }
}
