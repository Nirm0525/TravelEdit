-- Verificación de 0054 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_verify.sql
-- Cada fila debe tener ok = true.
with b as (
  select * from storage.buckets where id = 'proposal-service-files'
), t as (
  select c.oid, c.relrowsecurity from pg_class c
  where c.relnamespace = 'public'::regnamespace and c.relname = 'proposal_service_attachments'
), cols as (
  select column_name, is_nullable, column_default from information_schema.columns
  where table_schema = 'public' and table_name = 'proposal_service_attachments'
), fn as (
  select p.oid, p.prosecdef, p.proconfig, p.proacl, p.proowner from pg_proc p
  where p.pronamespace = 'public'::regnamespace and p.proname = 'enforce_service_attachment'
)
select 'la tabla existe con RLS activo' as check, exists (select 1 from t where relrowsecurity) as ok
union all select 'columnas mínimas (más updated_at)', (
  select count(*) = 11 from cols where column_name in
    ('id','proposal_id','service_id','file_name','storage_path','mime_type','file_size','visible_to_client','created_at','updated_at','created_by'))
union all select 'visible_to_client es not null y su default es false', exists (
  select 1 from cols where column_name = 'visible_to_client' and is_nullable = 'NO' and column_default = 'false')
union all select 'FK proposal_id → proposals con on delete cascade', exists (
  select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'f'
    and confrelid = 'public.proposals'::regclass and confdeltype = 'c')
union all select 'storage_path es único', exists (
  select 1 from pg_constraint where conrelid = (select oid from t) and contype = 'u' and conname = 'psa_storage_path_unique')
union all select 'checks: service_id, file_name, mime, tamaño', (
  select count(*) = 4 from pg_constraint where conrelid = (select oid from t) and contype = 'c'
    and conname in ('psa_service_id_not_blank','psa_file_name_not_blank','psa_mime_type_allowed','psa_file_size_range'))
union all select 'índice (proposal_id, service_id)', exists (
  select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_psa_proposal_service')
union all select 'anon y PUBLIC no tienen ningún privilegio sobre la tabla', not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_service_attachments' and grantee in ('anon', 'PUBLIC'))
union all select 'authenticated solo tiene SELECT', (
  select coalesce(array_agg(privilege_type::text order by privilege_type::text), '{}'::text[]) = array['SELECT']
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_service_attachments' and grantee = 'authenticated')
union all select 'service_role tiene INSERT, UPDATE y DELETE', (
  select count(distinct privilege_type) = 3 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_service_attachments'
    and grantee = 'service_role' and privilege_type in ('INSERT','UPDATE','DELETE'))
union all select 'una sola policy (SELECT para authenticated)', (
  select count(*) = 1 and bool_and(cmd = 'SELECT') and bool_and(roles = '{authenticated}')
  from pg_policies where schemaname = 'public' and tablename = 'proposal_service_attachments')
union all select 'la policy usa can_manage_proposals() y la visibilidad de proposals', exists (
  select 1 from pg_policies where schemaname = 'public' and tablename = 'proposal_service_attachments'
    and qual like '%can_manage_proposals%' and qual like '%proposals%')
union all select 'índice que cubre created_by', exists (
  select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_psa_created_by')
union all select 'la función del trigger no es ejecutable por PUBLIC, anon ni authenticated', exists (select 1 from fn)
  and not exists (
    select 1 from fn, aclexplode(coalesce(fn.proacl, acldefault('f', fn.proowner))) a
    where a.privilege_type = 'EXECUTE' and (a.grantee = 0 or a.grantee in (select oid from pg_roles where rolname in ('anon', 'authenticated'))))
union all select 'ninguna función SECURITY DEFINER de public referencia la tabla', not exists (
  select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef
    and pg_get_functiondef(p.oid) ilike '%proposal_service_attachments%')
union all select 'triggers de validación y updated_at', (
  select count(*) = 2 from pg_trigger where tgrelid = (select oid from t) and not tgisinternal
    and tgname in ('trg_psa_enforce','trg_psa_updated_at'))
union all select 'la función del trigger NO es SECURITY DEFINER y tiene search_path vacío', exists (
  select 1 from fn where not prosecdef and proconfig is not null and 'search_path=""' = any(proconfig))
union all select 'el bucket existe, es privado, 10 MB y solo PDF/JPEG/PNG/WebP', exists (
  select 1 from b where not public and file_size_limit = 10485760
    and allowed_mime_types @> array['application/pdf','image/jpeg','image/png','image/webp']
    and cardinality(allowed_mime_types) = 4)
union all select 'ninguna policy de storage.objects menciona este bucket', not exists (
  select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
    and (coalesce(qual, '') || coalesce(with_check, '')) like '%proposal-service-files%');
