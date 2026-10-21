-- Verificación de 0056 (solo lectura). Ejecutar justo después de aplicar la migración:
--   supabase db query --linked -f supabase/migration-scripts/0056_itinerary_sharing_verify.sql
-- Cada fila debe tener ok = true.
with fn as (
  select p.oid, n.nspname as schema_name, p.proname, p.prosecdef, p.proconfig, p.proacl,
         pg_get_functiondef(p.oid) as def,
         lower(regexp_replace(pg_get_functiondef(p.oid), '\s+', '', 'g')) as n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where (n.nspname = 'public' and p.proname in ('share_itinerary', 'unshare_itinerary', 'get_itinerary_share_readiness', 'can_travel', 'log_proposal_status_change', 'publish_proposal', 'unpublish_proposal'))
      or (n.nspname = 'private' and p.proname = 'itinerary_share_problems')
)
select 1 as n, 'las 3 RPC y el helper existen' as check,
       (select count(*) from fn where proname in ('share_itinerary', 'unshare_itinerary', 'get_itinerary_share_readiness', 'itinerary_share_problems')) = 4 as ok
union all select 2, 'RPC y helper: SECURITY DEFINER con search_path vacío',
       (select bool_and(prosecdef and 'search_path=""' = any(proconfig)) from fn
         where proname in ('share_itinerary', 'unshare_itinerary', 'get_itinerary_share_readiness', 'itinerary_share_problems'))
union all select 3, 'RPC: EXECUTE para authenticated; ni PUBLIC ni anon',
       not exists (
         select 1 from fn
          where proname in ('share_itinerary', 'unshare_itinerary', 'get_itinerary_share_readiness')
            and (proacl is null
                 or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)
                 or has_function_privilege('anon', oid, 'execute')
                 or not has_function_privilege('authenticated', oid, 'execute')))
union all select 4, 'helper de pendientes: nadie lo ejecuta directamente (ni anon, ni authenticated, ni PUBLIC)',
       not exists (
         select 1 from fn
          where proname = 'itinerary_share_problems'
            and (has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute')
                 or proacl is null or exists (select 1 from aclexplode(proacl) a where a.grantee = 0)))
union all select 5, 'can_travel conoce compartir (solo itinerario); eliminar sigue siendo solo admin',
       exists (select 1 from fn where proname = 'can_travel' and n like '%p_kind=''itinerary''andp_action=''compartir''%'
                and n like '%p_action=''eliminar''thenprivate.app_user_role()=''admin''%')
       and not exists (select 1 from fn where proname = 'can_travel' and n like '%p_kind=''proposal''andp_action=''compartir''%')
union all select 6, 'share_itinerary: solo itinerario, can_travel + propiedad, pendientes en el servidor, shared_at, sin published_at ni aceptación',
       exists (select 1 from fn where proname = 'share_itinerary'
                and n like '%v.kind<>''itinerary''%' and n like '%kind_not_supported%'
                and n like '%can_travel(v.kind,''compartir'')%' and n like '%is_own_or_full(v.advisor_id)%'
                and n like '%private.itinerary_share_problems(p_id,false)%'
                and n like '%status=''shared''%' and n like '%shared_at=now()%'
                and n not like '%published_at%' and n not like '%accepted%' and n not like '%pricing%' and n not like '%terms%')
union all select 7, 'unshare_itinerary: vuelve a draft, shared_at nulo y revoca TODAS las sesiones del itinerario',
       exists (select 1 from fn where proname = 'unshare_itinerary'
                and n like '%status=''draft''%' and n like '%shared_at=null%'
                and n like '%deletefrompublic.proposal_access_sessionswhereproposal_id=p_id%'
                and n like '%can_travel(v_kind,''compartir'')%' and n like '%is_own_or_full(v_advisor)%')
union all select 8, 'la lista de pendientes no mira precios, términos, aceptación, elecciones ni comentarios de cotización',
       exists (select 1 from fn where proname = 'itinerary_share_problems')
       and not exists (select 1 from fn where proname = 'itinerary_share_problems'
                        and (n like '%pricing%' or n like '%terms%' or n like '%accepted%' or n like '%service_choices%' or n like '%service_comments%'))
union all select 9, 'auditoría: itinerary_shared / itinerary_unshared para el itinerario y la rama de propuestas intacta',
       exists (select 1 from fn where proname = 'log_proposal_status_change'
                and n like '%''itinerary_shared''%' and n like '%''itinerary_unshared''%' and n like '%''itinerary_status_changed''%'
                and n like '%''proposal_status_changed''%')
union all select 10, 'publish_proposal y unpublish_proposal siguen rechazando itinerarios y no conocen share (sin cambios)',
       exists (select 1 from fn where proname = 'publish_proposal' and n like '%kind_not_supported%' and n not like '%shared%')
       and exists (select 1 from fn where proname = 'unpublish_proposal' and n like '%kind_not_supported%' and n not like '%shared%')
union all select 11, 'invariantes: ningún itinerario shared/viewed sin shared_at, ninguna propuesta con shared_at, ningún borrador con shared_at',
       not exists (select 1 from public.proposals where kind = 'itinerary' and status in ('shared', 'viewed') and shared_at is null)
       and not exists (select 1 from public.proposals where kind = 'proposal' and shared_at is not null)
       and not exists (select 1 from public.proposals where kind = 'itinerary' and status = 'draft' and shared_at is not null)
union all select 12, 'sin permisos nuevos de escritura: authenticated sigue sin poder escribir status, shared_at, viewed_at ni public_token (ni cambiar kind)',
       not exists (select 1 from information_schema.column_privileges
                    where table_schema = 'public' and table_name = 'proposals' and grantee = 'authenticated'
                      and ((privilege_type in ('INSERT', 'UPDATE') and column_name in ('status', 'shared_at', 'viewed_at', 'public_token'))
                           or (privilege_type = 'UPDATE' and column_name = 'kind')))
order by n;
