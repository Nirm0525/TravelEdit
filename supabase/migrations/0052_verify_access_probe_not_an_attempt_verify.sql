-- Verificación de 0052 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migrations/0052_verify_access_probe_not_an_attempt_verify.sql
-- Cada fila debe tener ok = true.
with f as (
  select p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def
  from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'verify_proposal_access'
)
select 'verify_proposal_access existe y es SECURITY DEFINER' as check, exists (select 1 from f where prosecdef) as ok
union all select 'search_path vacío', exists (select 1 from f where proconfig is not null and 'search_path=""' = any(proconfig))
union all select 'el código vacío o nulo se trata aparte (btrim) y no cuenta como intento', exists (
  select 1 from f where def like '%btrim(p_access_code)%' and def like '%invalid_code%')
union all select 'sigue devolviendo expired (0051)', exists (select 1 from f where def like '%''expired''::text%')
union all select 'sigue contando el código equivocado', exists (
  select 1 from f where def like '%access_attempts = c.access_attempts + 1%')
union all select 'anon y authenticated pueden ejecutarla; PUBLIC no', (
  select bool_and(has_function_privilege(r.oid, f.oid, 'EXECUTE')) from f, pg_roles r where r.rolname in ('anon', 'authenticated'))
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.proname = 'verify_proposal_access' and p.pronamespace = 'public'::regnamespace
      and a.grantee = 0 and a.privilege_type = 'EXECUTE');
