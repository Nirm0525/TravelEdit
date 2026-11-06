-- Módulo: Viajes — límite DIARIO persistente y atómico de llamadas al proveedor de geocodificación (Edge Function geocode-place).
-- Complementa 0057 (caché y turno global). NO modifica nada de 0057.
--
-- QUÉ HACE
--   1) private.geocode_daily_usage: una fila por (ámbito del proveedor, día UTC) con las llamadas externas hechas ese día. Compartida por
--      TODAS las instancias de la Edge Function (un contador en memoria no sirve: cada instancia tiene el suyo).
--   2) public.geocode_quota_take(ámbito, límite, consumir): informa o consume UNA llamada de forma atómica. Con p_take = true la
--      comprobación y el incremento son una sola sentencia (INSERT … ON CONFLICT DO UPDATE … WHERE calls < límite): bajo concurrencia
--      el contador NUNCA supera el límite. Devuelve (allowed, used, resets_in_seconds). Con p_take = false solo informa.
--      Cada intento externo se cuenta, incluidos los que acaban en error; los aciertos de caché no llegan aquí (no consumen).
--   3) SECURITY DEFINER, search_path vacío; solo service_role la ejecuta (ni anon ni authenticated; las tablas con RLS y sin policies).
--
-- NO HAY BLOQUEOS PERMANENTES: fija lock_timeout de 2 s; si no obtiene el bloqueo responde allowed = false y used = -1 («ocupado», se
--   falla CERRADO: no se llama al proveedor). El límite se acota en SQL (1–100000). Limpia filas de más de 7 días de forma acotada.
-- El día es UTC (resets_in_seconds = segundos hasta las 00:00 UTC).
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar la versión de geocode-place que usa Geoapify.
--
-- Aplicar: ver supabase/functions/geocode-place/README.md («Aplicar 0058»). Verificación (solo lectura):
--   supabase db query --remote -f supabase/migration-scripts/0058_geocode_daily_quota_verify.sql      (CLI < 3.0: --linked)
-- Revertir (a mano): supabase/migration-scripts/0058_geocode_daily_quota_rollback.sql
begin;

create schema if not exists private;

create table if not exists private.geocode_daily_usage (
  scope text    not null check (length(scope) between 1 and 40),
  day   date    not null,
  calls integer not null check (calls >= 0),
  primary key (scope, day)
);

alter table private.geocode_daily_usage enable row level security;
-- Sin policies: ningún rol de la API (anon / authenticated) puede leer ni escribir. service_role omite RLS.
revoke all on private.geocode_daily_usage from public, anon, authenticated;

create or replace function public.geocode_quota_take(p_scope text, p_limit integer, p_take boolean)
returns table (allowed boolean, used integer, resets_in_seconds integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 1), 1), 100000);
  v_day   date := (now() at time zone 'utc')::date;
  v_used  integer;
  v_reset integer := ceil(extract(epoch from (((v_day + 1)::timestamp at time zone 'utc') - now())))::integer;
begin
  perform set_config('lock_timeout', '2000', true);

  if p_take then
    -- Limpieza acotada de días antiguos.
    delete from private.geocode_daily_usage u
     where (u.scope, u.day) in (select d.scope, d.day from private.geocode_daily_usage d where d.day < v_day - 7 limit 50 for update skip locked);

    -- Comprobar y consumir en UNA sentencia: el contador nunca supera el límite, ni con cientos de conexiones a la vez.
    insert into private.geocode_daily_usage as u (scope, day, calls) values (p_scope, v_day, 1)
    on conflict (scope, day) do update set calls = u.calls + 1 where u.calls < v_limit
    returning u.calls into v_used;

    if found then
      return query select true, v_used, v_reset;
      return;
    end if;
  end if;

  select u.calls into v_used from private.geocode_daily_usage u where u.scope = p_scope and u.day = v_day;
  v_used := coalesce(v_used, 0);
  return query select v_used < v_limit and not p_take, v_used, v_reset;
exception
  when lock_not_available then
    return query select false, -1, v_reset;
end $$;

revoke all on function public.geocode_quota_take(text, integer, boolean) from public, anon, authenticated;
grant execute on function public.geocode_quota_take(text, integer, boolean) to service_role;

commit;
