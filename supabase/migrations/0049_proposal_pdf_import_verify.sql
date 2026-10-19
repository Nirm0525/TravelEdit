-- Verificación de 0049 (solo lectura). Ejecutar tras aplicar la migración:
--   supabase db query --linked -f supabase/migrations/0049_proposal_pdf_import_verify.sql
-- Cada fila debe tener ok = true.
select 'proposals.origin_channel existe' as check, exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'proposals'
    and column_name = 'origin_channel' and is_nullable = 'NO') as ok
union all select 'proposals.client_phone existe', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'proposals' and column_name = 'client_phone')
union all select 'proposals.lead_id admite null', exists (
  select 1 from information_schema.columns
  where table_schema = 'public' and table_name = 'proposals'
    and column_name = 'lead_id' and is_nullable = 'YES')
union all select 'propuestas con lead quedaron en web', not exists (
  select 1 from public.proposals where lead_id is not null and origin_channel <> 'web')
union all select 'canal de origen siempre válido', not exists (
  select 1 from public.proposals
  where origin_channel not in ('web', 'whatsapp', 'email', 'phone', 'referral', 'other'))
union all select 'proposal_imports existe con RLS', exists (
  select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'proposal_imports' and c.relrowsecurity)
union all select 'proposal_imports: solo policies select e insert', coalesce((
  select array_agg(policyname::text order by policyname) = array['proposal_imports_insert', 'proposal_imports_select']
  from pg_policies where schemaname = 'public' and tablename = 'proposal_imports'), false)
union all select 'proposal_imports: anon sin privilegios', not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_imports' and grantee = 'anon')
union all select 'proposal_imports: authenticated solo select/insert', not exists (
  select 1 from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'proposal_imports' and grantee = 'authenticated'
    and privilege_type not in ('SELECT', 'INSERT'))
union all select 'file_path: acepta <uid>/<uuid>.pdf', (
  '11111111-1111-1111-1111-111111111111/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf'
  ~ ('^' || '11111111-1111-1111-1111-111111111111' || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'))
union all select 'file_path: rechaza <uid>/../<otro-uid>/x.pdf', not (
  '11111111-1111-1111-1111-111111111111/../22222222-2222-2222-2222-222222222222/x.pdf'
  ~ ('^' || '11111111-1111-1111-1111-111111111111' || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'))
union all select 'file_path: rechaza <uid>/x/y.pdf', not (
  '11111111-1111-1111-1111-111111111111/x/y.pdf'
  ~ ('^' || '11111111-1111-1111-1111-111111111111' || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$'))
union all select 'policy de insert usa la validación exacta de file_path', exists (
  select 1 from pg_policies
  where schemaname = 'public' and tablename = 'proposal_imports'
    and policyname = 'proposal_imports_insert'
    and position('[0-9a-f]{12}' in with_check) > 0 and position('pdf$' in with_check) > 0)
union all select 'bucket proposal-imports privado, PDF, 20 MB', exists (
  select 1 from storage.buckets
  where id = 'proposal-imports' and public = false
    and file_size_limit = 20971520 and allowed_mime_types = array['application/pdf'])
union all select 'storage policies del bucket (lectura e inserción)', (
  select count(*) = 2 from pg_policies
  where schemaname = 'storage' and tablename = 'objects' and policyname like 'proposal_imports_storage_%');
