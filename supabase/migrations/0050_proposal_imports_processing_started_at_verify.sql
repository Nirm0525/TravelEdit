-- Verificación de 0050 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migrations/0050_proposal_imports_processing_started_at_verify.sql
-- Cada fila debe tener ok = true.
with fns as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proowner, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private'
    and p.proname in ('claim_proposal_import', 'count_active_proposal_imports', 'proposal_import_stale_after')
)
select 'proposal_imports.processing_started_at existe (timestamptz, admite null)' as check, exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'proposal_imports'
    and column_name = 'processing_started_at' and data_type = 'timestamp with time zone' and is_nullable = 'YES') as ok
union all select 'authenticated no puede escribir processing_started_at', not exists (
  select 1 from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'proposal_imports'
    and column_name = 'processing_started_at' and grantee = 'authenticated'
    and privilege_type in ('INSERT', 'UPDATE'))
union all select 'anon no tiene privilegios sobre processing_started_at', not exists (
  select 1 from information_schema.column_privileges
  where table_schema = 'public' and table_name = 'proposal_imports'
    and column_name = 'processing_started_at' and grantee = 'anon')
union all select 'authenticated sigue sin UPDATE/DELETE en proposal_imports', not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_imports' and grantee = 'authenticated'
    and privilege_type not in ('SELECT', 'INSERT'))
union all select 'las 3 funciones existen en private', (select count(*) = 3 from fns)
union all select 'claim_proposal_import devuelve public.proposal_imports', exists (
  select 1 from fns where proname = 'claim_proposal_import' and oid::regprocedure::text = 'private.claim_proposal_import(uuid)'
    and pg_get_function_result(oid) = 'proposal_imports')
union all select 'claim_proposal_import y count_active son security definer', (
  select count(*) = 2 from fns where proname in ('claim_proposal_import', 'count_active_proposal_imports') and prosecdef)
union all select 'las funciones tienen search_path vacío', (
  select count(*) = 3 from fns where proconfig is not null and ('search_path=""' = any(proconfig) or 'search_path=' = any(proconfig)))
union all select 'ninguna función es ejecutable por PUBLIC', not exists (
  select 1 from fns, aclexplode(coalesce(fns.proacl, acldefault('f', fns.proowner))) a
  where a.grantee = 0 and a.privilege_type = 'EXECUTE')
union all select 'anon y authenticated no tienen EXECUTE en ninguna', not exists (
  select 1 from fns, pg_roles r
  where r.rolname in ('anon', 'authenticated') and has_function_privilege(r.oid, fns.oid, 'EXECUTE'))
union all select 'service_role tiene EXECUTE en las 3', (
  select count(*) = 3 from fns, pg_roles r
  where r.rolname = 'service_role' and has_function_privilege(r.oid, fns.oid, 'EXECUTE'));
