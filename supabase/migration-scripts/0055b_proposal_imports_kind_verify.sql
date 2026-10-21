-- Verificación de 0055b (solo lectura). Ejecutar justo después de aplicar la migración:
--   supabase db query --linked -f supabase/migration-scripts/0055b_proposal_imports_kind_verify.sql
-- Cada fila debe tener ok = true.
with pol as (
  select * from pg_policies where schemaname = 'public' and tablename = 'proposal_imports'
), trg as (
  select t.tgname, t.tgenabled, pg_get_triggerdef(t.oid) as def
    from pg_trigger t where t.tgrelid = 'public.proposal_imports'::regclass and not t.tgisinternal
), con as (
  select conname, pg_get_constraintdef(oid) as def from pg_constraint where conrelid = 'public.proposal_imports'::regclass and contype = 'c'
), fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('enforce_import_kind_match', 'enforce_import_kind_immutable', 'enforce_import_targets_proposal')
)
select 1 as n, 'kind existe: text NOT NULL con DEFAULT proposal' as check,
       exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proposal_imports'
                and column_name = 'kind' and data_type = 'text' and is_nullable = 'NO' and column_default like '%proposal%') as ok
union all select 2, 'CHECK de kind (solo proposal | itinerary) y un itinerario solo se importa como nuevo',
       exists (select 1 from con where conname = 'proposal_imports_kind_check' and def like '%proposal%' and def like '%itinerary%')
       and exists (select 1 from con where conname = 'proposal_imports_itinerary_new_only' and def like '%new%')
union all select 3, 'ninguna importación existente quedó con un tipo distinto de proposal (válido solo justo tras aplicar)',
       not exists (select 1 from public.proposal_imports where kind <> 'proposal')
union all select 4, 'authenticated: puede INSERTAR kind pero NO actualizarlo, y sigue sin UPDATE/DELETE de tabla',
       exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'proposal_imports'
                and column_name = 'kind' and grantee = 'authenticated' and privilege_type = 'INSERT')
       and not exists (select 1 from information_schema.column_privileges where table_schema = 'public' and table_name = 'proposal_imports'
                and column_name = 'kind' and grantee = 'authenticated' and privilege_type = 'UPDATE')
       and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'proposal_imports'
                and grantee in ('anon', 'PUBLIC') )
       and not exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name = 'proposal_imports'
                and grantee = 'authenticated' and privilege_type in ('UPDATE', 'DELETE'))
union all select 5, 'policy de INSERT: conserva sus condiciones reales y exige can_travel(kind, crear)',
       exists (select 1 from pol where policyname = 'proposal_imports_insert' and cmd = 'INSERT'
                and with_check like '%can_manage_proposals()%' and with_check like '%can_travel(kind, ''crear''%'
                and with_check like '%created_by = auth.uid()%' and with_check like '%status = ''uploaded''%'
                and with_check like '%is_own_or_full%' and with_check like '%file_path%')
       and (select count(*) from pol) = 2
union all select 6, 'triggers: mismo tipo al enlazar y kind inmutable; el trigger solo-propuestas de 0055 ya no existe',
       exists (select 1 from trg where tgname = 'trg_proposal_imports_same_kind' and tgenabled = 'O' and def like '%BEFORE INSERT OR UPDATE OF proposal_id, kind%')
       and exists (select 1 from trg where tgname = 'trg_proposal_imports_kind_immutable' and tgenabled = 'O' and def like '%BEFORE UPDATE OF kind%')
       and not exists (select 1 from trg where tgname = 'trg_proposal_imports_only_proposals')
       and not exists (select 1 from fn where proname = 'enforce_import_targets_proposal')
union all select 7, 'funciones de trigger: INVOKER, search_path vacío, sin EXECUTE para PUBLIC, anon ni authenticated',
       (select count(*) from fn where proname in ('enforce_import_kind_match', 'enforce_import_kind_immutable')) = 2
       and not exists (
         select 1 from fn
          where proname in ('enforce_import_kind_match', 'enforce_import_kind_immutable')
            and (prosecdef or not ('search_path=""' = any(proconfig)) or proacl is null
                 or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
                 or has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')))
union all select 8, 'invariantes: ninguna importación enlazada a un registro de OTRO tipo; los itinerarios solo se importan como nuevos',
       not exists (select 1 from public.proposal_imports i join public.proposals p on p.id = i.proposal_id where p.kind <> i.kind)
       and not exists (select 1 from public.proposal_imports where kind = 'itinerary' and mode <> 'new')
union all select 9, 'RLS activa en proposal_imports y la policy de SELECT conserva su regla (permiso de gestión y propiedad)',
       exists (select 1 from pg_class where oid = 'public.proposal_imports'::regclass and relrowsecurity)
       and exists (select 1 from pol where policyname = 'proposal_imports_select' and cmd = 'SELECT'
                    and qual like '%can_manage_proposals()%' and qual like '%is_own_or_full(created_by)%')
order by n;
