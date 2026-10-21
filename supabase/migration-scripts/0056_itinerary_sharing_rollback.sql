-- Reversión de 0056 (compartir itinerarios). Devuelve can_travel y la auditoría de estado a como las dejó 0055.
-- SE NIEGA a ejecutarse si existe algún itinerario compartido o visto: sin share/unshare ya no se podría dejar de compartir,
-- y su enlace seguiría entregando contenido. Primero deja de compartirlos (unshare_itinerary) y luego revierte.
-- Ejecutar a mano (NO es una migración):
--   supabase db query --linked -f supabase/migration-scripts/0056_itinerary_sharing_rollback.sql
begin;

do $$
begin
  if exists (select 1 from public.proposals where kind = 'itinerary' and status in ('shared', 'viewed')) then
    raise exception 'Hay itinerarios compartidos o vistos: no se revierte 0056. Deja de compartirlos antes (unshare_itinerary).';
  end if;
end $$;

drop function if exists public.unshare_itinerary(uuid);
drop function if exists public.share_itinerary(uuid);
drop function if exists public.get_itinerary_share_readiness(uuid, boolean);
drop function if exists private.itinerary_share_problems(uuid, boolean);

-- can_travel de 0055 (sin 'compartir').
create or replace function public.can_travel(p_kind text, p_action text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_kind not in ('proposal', 'itinerary') then false
    when private.app_user_role() is null then false
    when p_action = 'eliminar' then private.app_user_role() = 'admin'
    when p_action in ('ver', 'crear', 'editar', 'gestionar_documentos')
      then private.app_user_role() in ('admin', 'editor', 'staff')
    when p_kind = 'proposal' and p_action in ('publicar', 'despublicar', 'gestionar_precios', 'gestionar_terminos')
      then private.app_user_role() in ('admin', 'editor', 'staff')
    else false
  end
$$;

-- log_proposal_status_change de 0055 (una sola acción, itinerary_status_changed, para los itinerarios).
CREATE OR REPLACE FUNCTION public.log_proposal_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_summary text;
begin

  -- Itinerario: textos propios. 0055 no genera la transición a 'shared' (llega con share_itinerary en 0056).
  if new.kind = 'itinerary' then
    v_summary := case new.status
      when 'shared' then 'Compartió el itinerario para "' || new.client_name || '"'
      when 'viewed' then 'El cliente visualizó el itinerario para "' || new.client_name || '"'
      when 'draft' then 'Dejó de compartir el itinerario para "' || new.client_name || '"'
      else 'Actualizó el estado del itinerario para "' || new.client_name || '"'
    end;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (auth.uid(), 'itinerary_status_changed', 'itinerary', new.id::text, v_summary);
    return new;
  end if;

  v_summary :=
    case new.status

      when 'published' then
        'Publicó la propuesta para "' ||
        new.client_name || '"'

      when 'viewed' then
        'El cliente visualizó la propuesta para "' ||
        new.client_name || '"'

      when 'accepted' then
        case
          when nullif(trim(new.accepted_by_name), '') is not null
            then
              'El cliente "' ||
              trim(new.accepted_by_name) ||
              '" aceptó la propuesta para "' ||
              new.client_name || '"'
          else
            'El cliente aceptó la propuesta para "' ||
            new.client_name || '"'
        end

      when 'expired' then
        'La propuesta para "' ||
        new.client_name ||
        '" expiró'

      when 'draft' then
        'Despublicó la propuesta para "' ||
        new.client_name || '"'

      else
        'Actualizó el estado de la propuesta para "' ||
        new.client_name || '"'

    end;


  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_status_changed',
    'proposal',
    new.id::text,
    v_summary
  );


  return new;

end;
$function$;

commit;
