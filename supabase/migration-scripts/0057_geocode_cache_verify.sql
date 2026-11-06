-- Verificación de 0057 (solo lectura). Ejecutar justo después de aplicar la migración:
--   supabase db query --remote --read-only -f supabase/migration-scripts/0057_geocode_cache_verify.sql   (CLI < 3.0: --linked en vez de --remote)
-- Cada fila debe tener ok = true.
with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('geocode_claim', 'geocode_store', 'geocode_release', 'geocode_reserve_slot', 'geocode_backoff', 'geocode_cache_purge')
)
select 1 as n, 'las 6 funciones geocode_* existen' as check, (select count(*) from fn) = 6 as ok
union all select 2, 'funciones: SECURITY DEFINER con search_path vacío',
       (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from fn)
union all select 3, 'funciones: EXECUTE solo para service_role (ni PUBLIC, ni anon, ni authenticated)',
       not exists (
         select 1 from fn
          where proacl is null
             or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
             or has_function_privilege('anon', oid, 'execute')
             or has_function_privilege('authenticated', oid, 'execute')
             or not has_function_privilege('service_role', oid, 'execute'))
union all select 4, 'las tablas existen con RLS activada y sin policies',
       (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'private' and c.relname in ('geocode_cache', 'geocode_rate_state') and c.relrowsecurity) = 2
       and not exists (select 1 from pg_policies where schemaname = 'private' and tablename in ('geocode_cache', 'geocode_rate_state'))
union all select 5, 'anon y authenticated no tienen ningún permiso sobre las tablas',
       not exists (
         select 1 from (values ('anon'), ('authenticated')) r(role_name),
                       (values ('private.geocode_cache'), ('private.geocode_rate_state')) t(rel),
                       (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
          where has_table_privilege(r.role_name, t.rel, p.priv))
union all select 6, 'índice de vencimiento de la caché',
       exists (select 1 from pg_indexes where schemaname = 'private' and indexname = 'geocode_cache_expires_at_idx')
order by n;
