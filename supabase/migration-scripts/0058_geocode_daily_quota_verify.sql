-- Verificación de 0058 (solo lectura). Ejecutar justo después de aplicar la migración:
--   supabase db query --remote --read-only -f supabase/migration-scripts/0058_geocode_daily_quota_verify.sql   (CLI < 3.0: --linked en vez de --remote)
-- Cada fila debe tener ok = true.
with fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl, p.prosrc
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'geocode_quota_take'
)
select 1 as n, 'existe public.geocode_quota_take' as check, (select count(*) from fn) = 1 as ok
union all select 2, 'SECURITY DEFINER con search_path vacío',
       (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from fn)
union all select 3, 'EXECUTE solo para service_role (ni PUBLIC, ni anon, ni authenticated)',
       not exists (
         select 1 from fn
          where proacl is null
             or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
             or has_function_privilege('anon', oid, 'execute')
             or has_function_privilege('authenticated', oid, 'execute')
             or not has_function_privilege('service_role', oid, 'execute'))
union all select 4, 'la tabla existe con RLS activada y sin policies',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = 'private' and c.relname = 'geocode_daily_usage' and c.relrowsecurity)
       and not exists (select 1 from pg_policies where schemaname = 'private' and tablename = 'geocode_daily_usage')
union all select 5, 'anon y authenticated no tienen ningún permiso sobre la tabla',
       not exists (
         select 1 from (values ('anon'), ('authenticated')) r(role_name),
                       (values ('select'), ('insert'), ('update'), ('delete')) p(priv)
          where has_table_privilege(r.role_name, 'private.geocode_daily_usage', p.priv))
union all select 6, 'comprobar y consumir es atómico (ON CONFLICT DO UPDATE … WHERE) y con lock_timeout',
       (select bool_and(prosrc like '%on conflict (scope, day) do update set calls = u.calls + 1 where u.calls < v_limit%' and prosrc like '%lock_timeout%') from fn)
order by n;
