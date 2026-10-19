-- Verificación de 0051 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migrations/0051_proposal_link_expiry_asks_for_code_verify.sql
-- Cada fila debe tener ok = true. (La prueba funcional como visitante anónimo se hace por HTTP,
-- ver el reporte: una llamada a /rest/v1/rpc/get_proposal_gate con la clave anon.)
with fns as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname in (
    'get_proposal_gate', 'verify_proposal_access', 'get_proposal_content', 'accept_proposal',
    'set_proposal_service_choice', 'set_proposal_service_comment')
)
select 'get_proposal_gate es SECURITY DEFINER (arregla "permission denied" para anon)' as check, exists (
  select 1 from fns where proname = 'get_proposal_gate' and prosecdef) as ok
union all select 'las 6 funciones públicas existen', (select count(*) = 6 from fns)
union all select 'las 6 son SECURITY DEFINER (prosecdef = true)', (select count(*) = 6 from fns where prosecdef)
union all select 'las 6 tienen search_path vacío', (
  select count(*) = 6 from fns where proconfig is not null and 'search_path=""' = any(proconfig))
union all select 'get_proposal_gate ya no filtra por expiración y devuelve expired', exists (
  select 1 from fns where proname = 'get_proposal_gate'
    and def like '%''expired''%' and def not like '%expires_at > now()%')
union all select 'verify_proposal_access devuelve expired y no filtra por expiración al buscar', exists (
  select 1 from fns where proname = 'verify_proposal_access'
    and def like '%''expired''::text%' and def not like '%expires_at > now()%')
union all select 'anon y authenticated pueden ejecutar get_proposal_gate', (
  select bool_and(has_function_privilege(r.oid, f.oid, 'EXECUTE'))
  from fns f, pg_roles r where f.proname = 'get_proposal_gate' and r.rolname in ('anon', 'authenticated'))
union all select 'anon y authenticated pueden ejecutar las 6', (
  select bool_and(has_function_privilege(r.oid, f.oid, 'EXECUTE'))
  from fns f, pg_roles r where r.rolname in ('anon', 'authenticated'))
union all select 'PUBLIC no puede ejecutar ninguna de las 6', not exists (
  select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  where p.proname in ('get_proposal_gate', 'verify_proposal_access', 'get_proposal_content', 'accept_proposal',
    'set_proposal_service_choice', 'set_proposal_service_comment') and p.pronamespace = 'public'::regnamespace
    and a.grantee = 0 and a.privilege_type = 'EXECUTE');
