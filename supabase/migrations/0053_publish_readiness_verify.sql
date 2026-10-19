-- Verificación de 0053 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migrations/0053_publish_readiness_verify.sql
-- Cada fila debe tener ok = true.
with r as (
  select p.oid, p.prosecdef, p.provolatile, p.proconfig, pg_get_functiondef(p.oid) as def,
         pg_get_function_result(p.oid) as resultado
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_publish_readiness'
), pub as (
  select p.oid, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) as def
  from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'publish_proposal'
)
select 'get_publish_readiness existe' as check, exists (select 1 from r) as ok
union all select 'es de solo lectura (STABLE) y SECURITY DEFINER', exists (select 1 from r where provolatile = 's' and prosecdef)
union all select 'search_path vacío', exists (select 1 from r where proconfig is not null and 'search_path=""' = any(proconfig))
union all select 'devuelve posición, código, mensaje, pestaña, día, servicio y línea', exists (
  select 1 from r where resultado like '%"position" integer%' and resultado like '%code text%' and resultado like '%message text%'
    and resultado like '%tab text%' and resultado like '%day_id text%' and resultado like '%service_id text%' and resultado like '%line_id text%')
union all select 'solo authenticated puede ejecutarla (no anon ni PUBLIC)', (
  select has_function_privilege(rl.oid, (select oid from r), 'EXECUTE') from pg_roles rl where rl.rolname = 'authenticated')
  and not (select has_function_privilege(rl.oid, (select oid from r), 'EXECUTE') from pg_roles rl where rl.rolname = 'anon')
  and not exists (
    select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
    where p.oid = (select oid from r) and a.grantee = 0 and a.privilege_type = 'EXECUTE')
union all select 'publish_proposal usa get_publish_readiness (una sola fuente de reglas)', exists (
  select 1 from pub where def like '%get_publish_readiness%')
union all select 'publish_proposal ya no repite las reglas dentro', not exists (
  select 1 from pub where def like '%v_missing%' or def like '%jsonb_array_length%')
union all select 'publish_proposal sigue SECURITY DEFINER, search_path vacío', exists (
  select 1 from pub where prosecdef and proconfig is not null and 'search_path=""' = any(proconfig))
union all select 'authenticated sigue pudiendo publicar; anon no', (
  select has_function_privilege(rl.oid, (select oid from pub), 'EXECUTE') from pg_roles rl where rl.rolname = 'authenticated')
  and not (select has_function_privilege(rl.oid, (select oid from pub), 'EXECUTE') from pg_roles rl where rl.rolname = 'anon');
