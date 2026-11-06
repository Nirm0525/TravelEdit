-- Módulo: Viajes — búsqueda de ubicaciones (Edge Function geocode-place). Caché persistente de consultas y coordinación del límite del proveedor.
--
-- QUÉ HACE
--   1) private.geocode_cache: resultados ya consultados, por (ámbito del proveedor, consulta normalizada). Una fila «pending» es la
--      reserva de quien está consultando al proveedor en ese momento (evita consultas duplicadas simultáneas entre instancias);
--      «ready» guarda los candidatos (jsonb) hasta expires_at. Las consultas SIN resultados también se guardan (con TTL corto).
--      El «ámbito» lo calcula la Edge Function a partir del proveedor y su URL base: otro proveedor, endpoint o idioma NUNCA reutiliza
--      entradas ni turnos de otro (ver geocode-place/nominatim.ts: cacheScope y cacheKey).
--   2) private.geocode_rate_state: una fila por ámbito con el siguiente instante en que se puede consultar. Un temporizador en
--      memoria no sirve porque cada instancia de la Edge Function tiene el suyo; aquí la reserva de turno es atómica (bloqueo de fila).
--   3) Funciones public.geocode_* (SECURITY DEFINER, search_path vacío): claim / store / release / reserve_slot / backoff / purge.
--      SOLO las ejecuta service_role (la Edge Function). Ni anon ni authenticated pueden llamarlas ni leer las tablas.
--
-- NINGÚN BLOQUEO PERMANENTE
--   - Una reserva («pending») tiene un lease acotado (máx. 300 s): si la instancia muere, la reserva vence sola y la siguiente
--     petición la reclama. Una entrada vencida NUNCA se sirve (se borra al reclamarla).
--   - Todas las funciones fijan lock_timeout (2 s): si otra conexión retiene un bloqueo de fila (p. ej. una instancia congelada
--     dentro de una transacción), no esperan sin fin: geocode_claim responde «wait» y geocode_reserve_slot responde -1 («ocupado»).
--   - Los parámetros tienen tope en SQL: pausa tras un error del proveedor ≤ 3600 s, intervalo entre consultas ≤ 60 s, lease ≤ 300 s.
--
-- LIMPIEZA: cada geocode_claim borra lo vencido de forma acotada (hasta 25 filas, sin esperar a otras conexiones) y la entrada
--   vencida de su propia clave, así la tabla se mantiene sola sin cron. Además existe geocode_cache_purge() para una limpieza
--   completa (ver el comentario del final para programarla con pg_cron si se desea).
--
-- QUÉ NO HACE: no toca proposals, contenido ni ninguna función existente. El proveedor y sus límites se configuran como secrets
--   de la Edge Function (GEOCODER_*), no aquí.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar geocode-place.
--
-- Aplicar: ver supabase/functions/geocode-place/README.md («Aplicar la migración»). Comprobación posterior (solo lectura):
--   supabase db query --remote -f supabase/migration-scripts/0057_geocode_cache_verify.sql
-- Revertir (a mano): supabase db query --remote -f supabase/migration-scripts/0057_geocode_cache_rollback.sql
begin;

create schema if not exists private;

-- ------------------------------------------------------------------
-- 1) Caché de consultas
-- ------------------------------------------------------------------
create table if not exists private.geocode_cache (
  provider    text        not null check (length(provider) between 1 and 40),
  query_key   text        not null check (length(query_key) between 1 and 400),
  query_text  text        not null check (length(query_text) <= 400),
  status      text        not null check (status in ('pending', 'ready')),
  results     jsonb       check (results is null or jsonb_typeof(results) = 'array'),
  lease_until timestamptz,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  primary key (provider, query_key),
  check ((status = 'ready') = (results is not null))
);

create index if not exists geocode_cache_expires_at_idx on private.geocode_cache (expires_at);

-- ------------------------------------------------------------------
-- 2) Turno global por ámbito de proveedor
-- ------------------------------------------------------------------
create table if not exists private.geocode_rate_state (
  provider     text        primary key check (length(provider) between 1 and 40),
  next_slot_at timestamptz not null default now()
);

alter table private.geocode_cache enable row level security;
alter table private.geocode_rate_state enable row level security;
-- Sin policies: ningún rol de la API (anon / authenticated) puede leer ni escribir. service_role omite RLS.
revoke all on private.geocode_cache from public, anon, authenticated;
revoke all on private.geocode_rate_state from public, anon, authenticated;

-- ------------------------------------------------------------------
-- 3) Funciones
-- ------------------------------------------------------------------

-- Reclama una consulta. Devuelve:
--   'hit'     — hay resultados vigentes (results)
--   'claimed' — el que llama debe consultar al proveedor y luego llamar a geocode_store o geocode_release
--   'wait'    — otra instancia la está consultando ahora (o hay un bloqueo momentáneo): volver a preguntar en unos instantes
create or replace function public.geocode_claim(p_provider text, p_key text, p_query text, p_lease_seconds integer)
returns table (state text, results jsonb)
language plpgsql security definer set search_path = '' as $$
declare
  v_row   private.geocode_cache%rowtype;
  v_lease integer := least(greatest(coalesce(p_lease_seconds, 30), 1), 300);
begin
  perform set_config('lock_timeout', '2000', true);

  -- La entrada de ESTA consulta, si ya venció (resultado viejo o reserva abandonada), se borra aquí mismo: nunca se sirve una vencida.
  delete from private.geocode_cache c where c.provider = p_provider and c.query_key = p_key and c.expires_at <= now();

  -- Limpieza acotada del resto de lo vencido. «skip locked»: no espera a otras conexiones ni cruza bloqueos con ellas (sin deadlocks).
  with doomed as (
    select e.provider, e.query_key from private.geocode_cache e where e.expires_at <= now() order by e.expires_at limit 25 for update skip locked
  )
  delete from private.geocode_cache c using doomed d where c.provider = d.provider and c.query_key = d.query_key;

  insert into private.geocode_cache (provider, query_key, query_text, status, lease_until, expires_at)
  values (p_provider, p_key, left(p_query, 400), 'pending', now() + make_interval(secs => v_lease), now() + make_interval(secs => v_lease))
  on conflict (provider, query_key) do nothing;

  if found then
    return query select 'claimed'::text, null::jsonb;
    return;
  end if;

  select * into v_row from private.geocode_cache c where c.provider = p_provider and c.query_key = p_key;
  if not found then
    -- La fila venció o se liberó entre medias: la siguiente llamada la reclamará.
    return query select 'wait'::text, null::jsonb;
    return;
  end if;
  if v_row.status = 'ready' and v_row.expires_at > now() then
    return query select 'hit'::text, v_row.results;
  else
    return query select 'wait'::text, null::jsonb;
  end if;
exception
  when lock_not_available then
    return query select 'wait'::text, null::jsonb;
end $$;

-- Guarda los resultados de una consulta reclamada (lista vacía = «sin resultados», con el TTL que indique quien llama).
create or replace function public.geocode_store(p_provider text, p_key text, p_results jsonb, p_ttl_seconds integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('lock_timeout', '2000', true);
  update private.geocode_cache
     set status = 'ready', results = coalesce(p_results, '[]'::jsonb), lease_until = null,
         expires_at = now() + make_interval(secs => least(greatest(coalesce(p_ttl_seconds, 1), 1), 31536000))
   where provider = p_provider and query_key = p_key;
exception
  when lock_not_available then
    null; -- no se pudo guardar ahora: la consulta siguiente simplemente volverá a pedirla (nunca se cachea un error)
end $$;

-- Libera una reserva sin guardar nada (error del proveedor, timeout…): los errores nunca se cachean.
create or replace function public.geocode_release(p_provider text, p_key text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('lock_timeout', '2000', true);
  delete from private.geocode_cache where provider = p_provider and query_key = p_key and status = 'pending';
exception
  when lock_not_available then
    null; -- la reserva vencerá sola al terminar su lease
end $$;

-- Reserva el siguiente turno global del ámbito. Devuelve los milisegundos que debe esperar quien llama antes de consultar,
-- o -1 si la espera superaría p_max_wait_ms o hay un bloqueo momentáneo (no se reserva nada: la función responde «ocupado»).
-- El bloqueo de fila serializa a todas las instancias: dos llamadas nunca reciben el mismo turno.
create or replace function public.geocode_reserve_slot(p_provider text, p_interval_ms integer, p_max_wait_ms integer)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_interval integer := least(greatest(coalesce(p_interval_ms, 1), 1), 60000);
  v_next     timestamptz;
  v_now      timestamptz;
  v_start    timestamptz;
  v_wait     integer;
begin
  perform set_config('lock_timeout', '2000', true);
  insert into private.geocode_rate_state (provider) values (p_provider) on conflict (provider) do nothing;
  select next_slot_at into v_next from private.geocode_rate_state where provider = p_provider for update;
  -- UNA sola lectura del reloj (tras tomar el bloqueo): leerlo dos veces daba esperas negativas (p. ej. -2) cuando el turno ya había
  -- pasado, y -1 significa «ocupado». La espera nunca es negativa.
  v_now := clock_timestamp();
  v_start := greatest(v_next, v_now);
  v_wait := greatest(0, ceil(extract(epoch from (v_start - v_now)) * 1000))::integer;
  if v_wait > greatest(coalesce(p_max_wait_ms, 0), 0) then
    return -1;
  end if;
  update private.geocode_rate_state
     set next_slot_at = v_start + make_interval(secs => v_interval / 1000.0)
   where provider = p_provider;
  return v_wait;
exception
  when lock_not_available then
    return -1;
end $$;

-- Pausa al ámbito (todas las instancias) tras un 429/403/503 del proveedor: no se vuelve a consultar hasta pasados p_seconds (tope 1 h).
create or replace function public.geocode_backoff(p_provider text, p_seconds integer)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('lock_timeout', '2000', true);
  insert into private.geocode_rate_state (provider) values (p_provider) on conflict (provider) do nothing;
  update private.geocode_rate_state
     set next_slot_at = greatest(next_slot_at, clock_timestamp() + make_interval(secs => least(greatest(coalesce(p_seconds, 1), 1), 3600)))
   where provider = p_provider;
exception
  when lock_not_available then
    null; -- otra conexión está actualizando el turno ahora mismo; no hace falta insistir
end $$;

-- Limpieza completa: filas vencidas y reservas abandonadas. Devuelve cuántas borró.
create or replace function public.geocode_cache_purge()
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  delete from private.geocode_cache where expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Supabase otorga EXECUTE a anon/authenticated por defecto en public: se retira explícitamente.
revoke all on function public.geocode_claim(text, text, text, integer) from public, anon, authenticated;
revoke all on function public.geocode_store(text, text, jsonb, integer) from public, anon, authenticated;
revoke all on function public.geocode_release(text, text) from public, anon, authenticated;
revoke all on function public.geocode_reserve_slot(text, integer, integer) from public, anon, authenticated;
revoke all on function public.geocode_backoff(text, integer) from public, anon, authenticated;
revoke all on function public.geocode_cache_purge() from public, anon, authenticated;
grant execute on function public.geocode_claim(text, text, text, integer) to service_role;
grant execute on function public.geocode_store(text, text, jsonb, integer) to service_role;
grant execute on function public.geocode_release(text, text) to service_role;
grant execute on function public.geocode_reserve_slot(text, integer, integer) to service_role;
grant execute on function public.geocode_backoff(text, integer) to service_role;
grant execute on function public.geocode_cache_purge() to service_role;

commit;

-- OPCIONAL — limpieza programada (requiere habilitar la extensión pg_cron en el proyecto; no es necesaria para que funcione):
--   select cron.schedule('geocode-cache-purge', '17 4 * * *', $$select public.geocode_cache_purge()$$);
