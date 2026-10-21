-- 0055 — PREFLIGHT de producción (SOLO LECTURA).
--
-- Una sola sentencia SELECT: no crea, no altera, no borra, no escribe. Pégala TAL CUAL en el SQL Editor de Supabase y
-- ejecútala. Devuelve una tabla (section, item, detail) con todo lo que 0055 necesita confirmar del catálogo REAL, porque
-- el repositorio y producción ya divergieron antes (0035, 0042, 0051).
--
-- Cómo devolver el resultado: usa «Export → CSV» o copia la columna `detail` de cada sección. Las definiciones de las
-- funciones (section 'function.def') son lo más importante: contienen el cuerpo real. No contiene datos de clientes,
-- códigos ni hashes: solo estructura (nombres, tipos, políticas, funciones y privilegios).
--
-- Secciones:
--   table.columns / table.constraints / table.indexes / table.triggers / table.privileges / table.acl → public.proposals
--   rls.flags / rls.policies                       → proposals, proposal_access_credentials, proposal_access_sessions,
--                                                     proposal_imports, proposal_service_attachments
--   function.meta / function.def / function.grants → las 18 funciones pedidas + las 3 de auditoría (todas sus sobrecargas)
--   fk.to_proposals                                → toda FK hacia proposals (de cualquier tabla)
--   audit.triggers / audit.functions / audit.log_table
--   permissions.tables / permissions.columns       → ¿existe infraestructura de permisos/roles en la base?
--   permissions.helper_defs                        → app_user_role() y helpers de rol
--   dependents.views / dependents.functions        → vistas y funciones que mencionan proposals
--   env.extensions / env.row_counts_by_status      → pgcrypto y conteos por estado (sin datos personales)

with
target_fns(name) as (
  values
    ('can_manage_proposals'), ('is_own_or_full'), ('publish_proposal'), ('unpublish_proposal'),
    ('get_publish_readiness'), ('set_proposal_access_code'), ('generate_proposal_access_code'),
    ('proposal_has_access_code'), ('get_proposal_gate'), ('verify_proposal_access'), ('get_proposal_content'),
    ('accept_proposal'), ('set_proposal_service_choice'), ('set_proposal_service_comment'),
    ('enforce_proposal_advisor'), ('recompute_proposal_pricing'), ('enforce_credential_ownership'),
    ('enforce_service_attachment'), ('log_proposal_created'), ('log_proposal_status_change'), ('log_proposal_deleted')
),
fns as (
  select p.oid, n.nspname as schema_name, p.proname, p.prokind, p.prosecdef, p.proconfig, p.proacl,
         pg_get_function_identity_arguments(p.oid) as args,
         pg_get_function_result(p.oid) as result,
         p.provolatile
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where p.proname in (select name from target_fns)
     and n.nspname in ('public', 'private')
),
policy_tables(tbl) as (
  values ('proposals'), ('proposal_access_credentials'), ('proposal_access_sessions'),
         ('proposal_imports'), ('proposal_service_attachments')
),
rows_all as (

  -- ---------------------------------------------------------------- public.proposals
  select 'table.columns' as section,
         a.attnum::text || ' ' || a.attname as item,
         jsonb_build_object(
           'type', format_type(a.atttypid, a.atttypmod),
           'not_null', a.attnotnull,
           'default', pg_get_expr(d.adbin, d.adrelid),
           'generated', nullif(a.attgenerated::text, ''),
           'identity', nullif(a.attidentity::text, '')
         )::text as detail
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.proposals'::regclass and a.attnum > 0 and not a.attisdropped

  union all
  select 'table.constraints', c.conname || ' (' || c.contype::text || ')', pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = 'public.proposals'::regclass

  union all
  select 'table.indexes', i.indexname, i.indexdef
    from pg_indexes i
   where i.schemaname = 'public' and i.tablename = 'proposals'

  union all
  select 'table.triggers', t.tgname,
         jsonb_build_object(
           'enabled', t.tgenabled,
           'function', t.tgfoid::regprocedure::text,
           'definition', pg_get_triggerdef(t.oid)
         )::text
    from pg_trigger t
   where t.tgrelid = 'public.proposals'::regclass and not t.tgisinternal

  union all
  select 'table.privileges', 'table ' || g.grantee || ' ' || g.privilege_type, ''
    from information_schema.role_table_grants g
   where g.table_schema = 'public' and g.table_name = 'proposals'
     and g.grantee in ('anon', 'authenticated', 'service_role', 'PUBLIC')
  union all
  select 'table.privileges', 'column ' || cp.grantee || ' ' || cp.privilege_type, cp.column_name
    from information_schema.column_privileges cp
   where cp.table_schema = 'public' and cp.table_name = 'proposals'
     and cp.grantee in ('anon', 'authenticated')
     and cp.column_name in ('kind', 'status', 'access_required', 'expires_at', 'published_at', 'accepted_at',
                            'terms_accepted', 'service_choices', 'service_comments', 'advisor_id', 'created_by')

  -- ACL EXACTA de la tabla y de sus columnas (sirve para restaurar los privilegios tal cual en el rollback).
  union all
  select 'table.acl', 'relacl', coalesce(c.relacl::text, '(sin ACL explícita)')
    from pg_class c
   where c.oid = 'public.proposals'::regclass
  union all
  select 'table.acl', 'column ' || a.attname, a.attacl::text
    from pg_attribute a
   where a.attrelid = 'public.proposals'::regclass and a.attnum > 0 and not a.attisdropped and a.attacl is not null

  -- ---------------------------------------------------------------- RLS
  union all
  select 'rls.flags', c.relname,
         jsonb_build_object('rls_enabled', c.relrowsecurity, 'rls_forced', c.relforcerowsecurity)::text
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
   where c.relname in (select tbl from policy_tables)

  union all
  select 'rls.policies', pol.tablename || '.' || pol.policyname,
         jsonb_build_object(
           'command', pol.cmd,
           'permissive', pol.permissive,
           'roles', pol.roles,
           'using', pol.qual,
           'with_check', pol.with_check
         )::text
    from pg_policies pol
   where pol.schemaname = 'public' and pol.tablename in (select tbl from policy_tables)

  -- ---------------------------------------------------------------- funciones
  union all
  select 'function.meta', f.schema_name || '.' || f.proname || '(' || f.args || ')',
         jsonb_build_object(
           'returns', f.result,
           'security', case when f.prosecdef then 'DEFINER' else 'INVOKER' end,
           'search_path', (select cfg from unnest(f.proconfig) cfg where cfg like 'search_path=%'),
           'volatility', f.provolatile,
           'kind', f.prokind
         )::text
    from fns f

  union all
  select 'function.def', f.schema_name || '.' || f.proname || '(' || f.args || ')', pg_get_functiondef(f.oid)
    from fns f
   where f.prokind = 'f'

  union all
  select 'function.grants', f.schema_name || '.' || f.proname || '(' || f.args || ')',
         coalesce(
           (select string_agg(
                     (case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end) || ':' || a.privilege_type,
                     ', ' order by a.grantee)
              from aclexplode(f.proacl) a),
           'sin ACL explícita (por defecto: PUBLIC puede ejecutar)')
    from fns f

  -- ---------------------------------------------------------------- dependencias
  union all
  select 'fk.to_proposals', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.contype = 'f' and c.confrelid = 'public.proposals'::regclass

  -- ---------------------------------------------------------------- auditoría
  union all
  select 'audit.triggers', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)
    from pg_trigger t
    join pg_proc p on p.oid = t.tgfoid
   where not t.tgisinternal
     and (p.prosrc ilike '%audit_log%')
     and (t.tgrelid = 'public.proposals'::regclass or p.prosrc ilike '%proposal%')

  union all
  select 'audit.functions', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.prosrc ilike '%audit_log%' and p.prosrc ilike '%proposal%'

  union all
  select 'audit.log_table', 'column ' || a.attname, format_type(a.atttypid, a.atttypmod)
    from pg_attribute a
   where a.attrelid = to_regclass('public.audit_log') and a.attnum > 0 and not a.attisdropped
  union all
  select 'audit.log_table', 'constraint ' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = to_regclass('public.audit_log') and c.contype = 'c'

  -- ---------------------------------------------------------------- ¿hay infraestructura de permisos?
  union all
  select 'permissions.tables', n.nspname || '.' || c.relname || ' (' || c.relkind::text || ')', ''
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname in ('public', 'private')
     and c.relkind in ('r', 'v', 'm', 'p')
     and (c.relname ilike '%permission%' or c.relname ilike '%role%' or c.relname ilike '%grant%'
          or c.relname ilike '%privilege%' or c.relname ilike '%capabilit%')
  union all
  select 'permissions.tables', 'ver también: public.profiles', 'columnas: ' ||
         coalesce((select string_agg(attname, ', ' order by attnum) from pg_attribute
                    where attrelid = 'public.profiles'::regclass and attnum > 0 and not attisdropped), '(no existe)')
  union all
  select 'permissions.columns', c.conrelid::regclass::text || '.' || c.conname, pg_get_constraintdef(c.oid)
    from pg_constraint c
   where c.conrelid = 'public.profiles'::regclass and c.contype = 'c'
  union all
  select 'permissions.helper_defs', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         pg_get_functiondef(p.oid)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and (p.proname in ('app_user_role', 'can_manage_leads', 'can_manage_content', 'is_admin', 'current_role_name')
          or p.proname ilike 'can\_%' or p.proname ilike 'has\_%perm%' or p.proname ilike '%permission%')

  -- ---------------------------------------------------------------- otros dependientes
  union all
  select 'dependents.views', schemaname || '.' || viewname, definition
    from pg_views
   where schemaname in ('public', 'private') and definition ilike '%proposals%'
  union all
  select 'dependents.functions', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ''
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private') and p.prokind = 'f'
     and p.prosrc ilike '%proposals%'
     and p.proname not in (select name from target_fns)

  -- ---------------------------------------------------------------- entorno
  union all
  select 'env.extensions', e.extname, 'schema=' || n.nspname || ' version=' || e.extversion
    from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace
   where e.extname in ('pgcrypto', 'pg_stat_statements')
  union all
  -- Solo conteos agregados: sirven para saber que ninguna fila viola los CHECK nuevos. Sin datos personales.
  select 'env.row_counts_by_status', p.status,
         jsonb_build_object('rows', count(*), 'with_published_at', count(p.published_at),
                            'with_accepted_at', count(p.accepted_at), 'with_expires_at', count(p.expires_at))::text
    from public.proposals p
   group by p.status
)
select section, item, detail
  from rows_all
 order by section, item;
