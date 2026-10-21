-- Verificación de 0055 (solo lectura). Ejecutar justo después de aplicar la migración:
--   supabase db query --linked -f supabase/migration-scripts/0055_travel_kinds_verify.sql
-- Cada fila debe tener ok = true. La comprobación 7 describe el estado INMEDIATAMENTE posterior a aplicar (todavía no hay
-- itinerarios); más adelante dejará de ser cierta a propósito: las demás deben cumplirse siempre.
-- Lo que NO se puede probar sin escribir (p. ej. que accept_proposal rechace un itinerario) se comprueba por la definición
-- de la función; el comportamiento real lo cubren las pruebas de la migración (_shared/travel_kinds_migration_test.ts).
with col as (
  select a.attname, a.attnotnull, format_type(a.atttypid, a.atttypmod) as typ, pg_get_expr(d.adbin, d.adrelid) as def
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.proposals'::regclass and a.attnum > 0 and not a.attisdropped
), con as (
  select c.conname, pg_get_constraintdef(c.oid) as def from pg_constraint c
   where c.conrelid = 'public.proposals'::regclass and c.contype = 'c'
), pol as (
  select * from pg_policies where schemaname = 'public' and tablename = 'proposals'
), fn as (
  select p.oid, p.proname, p.prosecdef, p.proconfig, p.proacl,
         pg_get_functiondef(p.oid) as def, pg_get_function_result(p.oid) as res,
         lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) as n
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and p.proname in ('can_travel', 'enforce_proposal_kind_immutable', 'enforce_import_targets_proposal',
                       'publish_proposal', 'unpublish_proposal', 'accept_proposal',
                       'set_proposal_service_choice', 'set_proposal_service_comment',
                       'get_proposal_gate', 'verify_proposal_access', 'get_proposal_content',
                       'recompute_proposal_pricing', 'enforce_proposal_advisor', 'enforce_credential_ownership',
                       'log_proposal_created', 'log_proposal_status_change', 'log_proposal_deleted')
), fn2 as (
  select p.proname, lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) as n
    from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('set_proposal_access_code', 'generate_proposal_access_code')
), trig_fn as (
  select unnest(array['enforce_proposal_kind_immutable', 'enforce_import_targets_proposal', 'recompute_proposal_pricing',
                      'enforce_proposal_advisor', 'enforce_credential_ownership']) as name
), upd_cols as (
  select column_name from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'proposals' and grantee = 'authenticated' and privilege_type = 'UPDATE'
), ins_cols as (
  select column_name from information_schema.column_privileges
   where table_schema = 'public' and table_name = 'proposals' and grantee = 'authenticated' and privilege_type = 'INSERT'
)
select 1 as n, 'kind existe' as check,
       exists (select 1 from col where attname = 'kind' and typ = 'text') as ok
union all select 2, 'kind es NOT NULL',
       exists (select 1 from col where attname = 'kind' and attnotnull)
union all select 3, 'kind tiene DEFAULT ''proposal''',
       exists (select 1 from col where attname = 'kind' and def like '%''proposal''%')
union all select 4, 'CHECK de kind (solo proposal | itinerary)',
       exists (select 1 from con where conname = 'proposals_kind_check' and def like '%proposal%' and def like '%itinerary%')
union all select 5, 'shared_at existe, timestamptz y admite null',
       exists (select 1 from col where attname = 'shared_at' and typ = 'timestamp with time zone' and not attnotnull)
union all select 6, 'CHECK compuesto kind/status; no queda un CHECK de status suelto',
       exists (select 1 from con where conname = 'proposals_kind_status_check' and def like '%shared%' and def like '%accepted%' and def like '%itinerary%')
       and (select count(*) from con where def like '%''published''%' and conname <> 'proposals_kind_status_check') = 0
union all select 7, 'filas legacy: todas son proposal (válido solo justo tras aplicar)',
       not exists (select 1 from public.proposals where kind <> 'proposal')
union all select 8, 'invariantes: ninguna propuesta con shared_at; ningún itinerario con published_at/aceptación/totales o shared incoherente',
       not exists (select 1 from public.proposals where kind = 'proposal' and shared_at is not null)
       and not exists (select 1 from public.proposals where kind = 'itinerary'
                        and (published_at is not null or accepted_at is not null or accepted_by_name is not null
                             or terms_accepted or pricing_subtotal <> 0 or pricing_fees <> 0 or pricing_total <> 0
                             or (status = 'draft' and shared_at is not null)
                             or (status in ('shared', 'viewed') and shared_at is null)))
union all select 9, 'CHECK de forma por tipo: cubre shared_at, aceptación, precios, elecciones, comentarios y coherencia estado/shared_at',
       exists (select 1 from con where conname = 'proposals_kind_shape_check'
                and def like '%shared_at%' and def like '%accepted_at%' and def like '%terms_accepted%' and def like '%pricing_total%'
                and def like '%service_choices%' and def like '%service_comments%')
union all select 10, 'trigger de kind inmutable: habilitado, BEFORE UPDATE OF kind',
       exists (select 1 from pg_trigger t where t.tgrelid = 'public.proposals'::regclass and t.tgname = 'trg_proposals_kind_immutable'
                and t.tgenabled = 'O' and pg_get_triggerdef(t.oid) like '%BEFORE UPDATE OF kind%')
union all select 11, 'proposals: 4 policies por tipo; UPDATE con USING y WITH CHECK; DELETE exige la acción eliminar (solo admin)',
       (select count(*) from pol) = 4
       and exists (select 1 from pol where cmd = 'SELECT' and qual like '%can_travel(kind, ''ver''%' and qual like '%is_own_or_full(advisor_id)%')
       and exists (select 1 from pol where cmd = 'INSERT' and with_check like '%can_travel(kind, ''crear''%' and with_check like '%created_by%')
       and exists (select 1 from pol where cmd = 'UPDATE' and qual like '%can_travel(kind, ''editar''%' and qual like '%is_own_or_full(advisor_id)%'
                    and with_check like '%can_travel(kind, ''editar''%' and with_check like '%is_own_or_full(advisor_id)%')
       and exists (select 1 from pol where cmd = 'DELETE' and qual like '%can_travel(kind, ''eliminar''%')
union all select 12, 'can_travel: SECURITY INVOKER, search_path vacío, boolean; eliminar solo admin; sin tabla de permisos inventada',
       exists (select 1 from fn where proname = 'can_travel' and not prosecdef and res = 'boolean'
                and 'search_path=""' = any(proconfig)
                and def like '%''eliminar''%' and def like '%= ''admin''%')
       and not exists (select 1 from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
                        and c.relname in ('permissions', 'role_permissions', 'roles'))
union all select 13, 'anon: sin EXECUTE en can_travel ni en publish/unpublish; con EXECUTE en las RPC públicas; sin privilegios de tabla',
       not has_function_privilege('anon', 'public.can_travel(text,text)', 'execute')
       and not has_function_privilege('anon', 'public.publish_proposal(uuid)', 'execute')
       and not has_function_privilege('anon', 'public.unpublish_proposal(uuid)', 'execute')
       and has_function_privilege('anon', 'public.get_proposal_gate(uuid)', 'execute')
       and has_function_privilege('anon', 'public.verify_proposal_access(uuid,text)', 'execute')
       and has_function_privilege('anon', 'public.get_proposal_content(uuid,uuid)', 'execute')
       and has_function_privilege('anon', 'public.accept_proposal(uuid,uuid,text)', 'execute')
       and has_function_privilege('anon', 'public.set_proposal_service_choice(uuid,uuid,text,boolean)', 'execute')
       and has_function_privilege('anon', 'public.set_proposal_service_comment(uuid,uuid,text,text)', 'execute')
       and not exists (select 1 from information_schema.role_table_grants
                        where table_schema = 'public' and table_name = 'proposals' and grantee in ('anon', 'PUBLIC'))
union all select 14, 'authenticated: EXECUTE en can_travel y en publish/unpublish',
       has_function_privilege('authenticated', 'public.can_travel(text,text)', 'execute')
       and has_function_privilege('authenticated', 'public.publish_proposal(uuid)', 'execute')
       and has_function_privilege('authenticated', 'public.unpublish_proposal(uuid)', 'execute')
union all select 15, 'RPC comerciales rechazan itinerario de forma explícita (kind_not_supported); publish/unpublish exigen ser dueña (staff); lógica real intacta',
       (select count(*) from fn where proname = 'publish_proposal' and n like '%v_proposal.kind<>''proposal''%' and n like '%kind_not_supported%'
                and n like '%is_own_or_full(v_proposal.advisor_id)%' and n like '%solosepuedepublicarunapropuestaenestadodraft%'
                and n like '%published_at=now()%' and n like '%faltandatosparapublicar%') = 1
       and (select count(*) from fn where proname = 'unpublish_proposal' and n like '%v_kind<>''proposal''%'
                and n like '%kind_not_supported%' and n like '%is_own_or_full(v_advisor)%' and n like '%andkind=''proposal''%'
                and n like '%statusin(''published'',''viewed'')%' and n like '%yafueaceptada%'
                and n like '%deletefrompublic.proposal_access_sessions%') = 1
       and (select count(*) from fn where proname = 'accept_proposal' and n like '%v_kind<>''proposal''%' and n like '%kind_not_supported%'
                and n like '%cannot_accept_in_current_status%' and n like '%accepted_by_name_required%') = 1
       and (select count(*) from fn where proname = 'set_proposal_service_choice' and n like '%v_kind<>''proposal''%' and n like '%kind_not_supported%'
                and n like '%service_not_found%' and n like '%''published'',''shared'',''viewed''%') = 1
       and (select count(*) from fn where proname = 'set_proposal_service_comment' and n like '%v_kind<>''proposal''%' and n like '%kind_not_supported%'
                and n like '%comment_too_long%' and n like '%>1000%' and n like '%''published'',''shared'',''viewed''%') = 1
union all select 16, 'acceso privado con kind: gate y contenido devuelven kind; proposal published|viewed|accepted; itinerary shared|viewed',
       exists (select 1 from fn where proname = 'get_proposal_gate' and res like '%kind text%'
                and n like '%p.kind=''itinerary''andp.statusin(''shared'',''viewed'')%' and n like '%p.kind=''proposal''andp.statusin(''published'',''viewed'',''accepted'')%')
       and exists (select 1 from fn where proname = 'verify_proposal_access'
                    and n like '%p.kind=''itinerary''andp.statusin(''shared'',''viewed'')%' and n like '%p.kind=''proposal''andp.statusin(''published'',''viewed'',''accepted'')%')
       and exists (select 1 from fn where proname = 'get_proposal_content' and res like '%kind text%'
                    and n like '%p.kind=''itinerary''andp.statusin(''shared'',''viewed'')%' and n like '%p.kind=''proposal''andp.statusin(''published'',''viewed'',''accepted'')%'
                    and n like '%p.kind=''itinerary''andp.status=''shared''%')
union all select 17, 'contenido filtra lo contractual en el servidor (pricing, terms, totales, aceptación, elecciones, comentarios)',
       exists (select 1 from fn where proname = 'get_proposal_content'
                and n like '%(p.content-''pricing''-''terms'')%' and n like '%then0::numericelsep.pricing_total%'
                and n like '%thenfalseelsep.terms_accepted%' and n like '%thennull::timestamptzelsep.accepted_at%'
                and n like '%then''{}''::jsonbelse%')
union all select 18, 'importaciones: trigger activo que solo admite kind = proposal',
       exists (select 1 from pg_trigger t where t.tgrelid = 'public.proposal_imports'::regclass
                and t.tgname = 'trg_proposal_imports_only_proposals' and t.tgenabled = 'O')
       and exists (select 1 from fn where proname = 'enforce_import_targets_proposal' and not prosecdef and def like '%kind = ''proposal''%')
union all select 19, 'documentos adjuntos: FK intacta y psa_select por tipo Y propiedad de la asesora',
       exists (select 1 from pg_constraint where conrelid = 'public.proposal_service_attachments'::regclass
                and contype = 'f' and confrelid = 'public.proposals'::regclass and confdeltype = 'c')
       and exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'proposal_service_attachments'
                    and policyname = 'psa_select' and qual like '%can_travel(p.kind, ''gestionar_documentos''%'
                    and qual like '%is_own_or_full(p.advisor_id)%')
       and (select count(*) from pg_policies where schemaname = 'public' and tablename = 'proposal_service_attachments') = 1
union all select 20, 'trigger de precios: itinerario siempre 0, propuesta con el cálculo de siempre; search_path vacío',
       exists (select 1 from fn where proname = 'recompute_proposal_pricing' and 'search_path=""' = any(proconfig)
                and n like '%new.kind=''itinerary''%' and n like '%new.pricing_total:=0%'
                and n like '%new.pricing_subtotal+new.pricing_fees%')
union all select 21, 'hardening: authenticated NO puede escribir status, published_at, shared_at, viewed_at, accepted_at, accepted_by_name, terms_accepted, service_choices, service_comments, public_token ni pricing_*',
       not exists (select 1 from upd_cols where column_name in ('status', 'published_at', 'shared_at', 'viewed_at', 'accepted_at',
                    'accepted_by_name', 'terms_accepted', 'service_choices', 'service_comments', 'public_token', 'kind',
                    'pricing_subtotal', 'pricing_fees', 'pricing_total', 'id', 'created_by', 'created_at', 'updated_at'))
       and not exists (select 1 from ins_cols where column_name in ('status', 'published_at', 'shared_at', 'viewed_at', 'accepted_at',
                    'accepted_by_name', 'terms_accepted', 'service_choices', 'service_comments', 'public_token',
                    'pricing_subtotal', 'pricing_fees', 'pricing_total'))
union all select 22, 'hardening: authenticated sí escribe lo que el panel usa (content, datos del cliente, acceso) y puede insertar kind',
       (select count(*) from upd_cols where column_name in ('client_name', 'client_email', 'destination_text', 'start_date', 'end_date',
                    'travelers_count', 'advisor_id', 'currency', 'access_required', 'expires_at', 'content')) = 11
       and exists (select 1 from ins_cols where column_name = 'kind')
       and exists (select 1 from ins_cols where column_name = 'content')
union all select 23, 'funciones de trigger sin EXECUTE para PUBLIC, anon ni authenticated',
       not exists (
         select 1 from fn join trig_fn t on t.name = fn.proname
          where fn.proacl is null or exists (select 1 from aclexplode(fn.proacl) a where a.grantee = 0)
             or has_function_privilege('anon', fn.oid, 'execute') or has_function_privilege('authenticated', fn.oid, 'execute'))
union all select 24, 'SECURITY DEFINER con search_path vacío en RPC y auditoría; INVOKER en helpers y triggers de validación',
       (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from fn
         where proname in ('publish_proposal', 'unpublish_proposal', 'accept_proposal', 'set_proposal_service_choice',
                           'set_proposal_service_comment', 'get_proposal_gate', 'verify_proposal_access',
                           'get_proposal_content', 'log_proposal_created', 'log_proposal_status_change', 'log_proposal_deleted'))
       and (select bool_and(not prosecdef and 'search_path=""' = any(proconfig)) from fn
             where proname in ('can_travel', 'enforce_proposal_kind_immutable', 'enforce_import_targets_proposal',
                               'recompute_proposal_pricing'))
union all select 25, 'auditoría: itinerario con entity_type itinerary y acciones itinerary_*; propuesta conserva proposal',
       exists (select 1 from fn where proname = 'log_proposal_created' and n like '%''itinerary_created'',''itinerary''%' and n like '%''proposal_created'',''proposal''%')
       and exists (select 1 from fn where proname = 'log_proposal_deleted' and n like '%''itinerary_deleted'',''itinerary''%' and n like '%''proposal_deleted'',''proposal''%')
       and exists (select 1 from fn where proname = 'log_proposal_status_change' and n like '%''itinerary_status_changed'',''itinerary''%' and n like '%''proposal_status_changed'',''proposal''%')
union all select 27, 'código de acceso: permiso y auditoría por tipo (set y generate)',
       (select count(*) from fn2 where n like '%can_travel(v_kind,''editar'')%' and n like '%''itinerary_access_code_changed''%') = 2
union all select 26, 'sin permisos inesperados: ninguna función nueva/cambiada ejecutable por PUBLIC',
       not exists (
         select 1 from fn
          where proname in ('can_travel', 'publish_proposal', 'unpublish_proposal', 'get_proposal_gate',
                            'verify_proposal_access', 'get_proposal_content', 'accept_proposal',
                            'set_proposal_service_choice', 'set_proposal_service_comment')
            and (proacl is null or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)))
union all select 28, 'auditoría: log_proposal_* con ACL exacta de producción (solo postgres y service_role; sin PUBLIC, anon ni authenticated)',
       (select count(*) from fn where proname in ('log_proposal_created', 'log_proposal_status_change', 'log_proposal_deleted')) = 3
       and not exists (
         select 1 from fn
          where proname in ('log_proposal_created', 'log_proposal_status_change', 'log_proposal_deleted')
            and (proacl is null
                 or has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
                 or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
                 or not has_function_privilege('service_role', oid, 'execute')
                 or exists (select 1 from aclexplode(proacl) a where a.grantee not in ('postgres'::regrole, 'service_role'::regrole))))
order by n;
