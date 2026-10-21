-- Módulo: Viajes — compartir un ITINERARIO con el cliente (share / unshare) y su lista de pendientes. Completa 0055.
--
-- SEMÁNTICA (propia del itinerario; NO se reutiliza publish/unpublish y no se toca ninguna función de propuesta):
--     draft ──share_itinerary──▶ shared ──(primera lectura válida del cliente, get_proposal_content de 0055)──▶ viewed
--     shared | viewed ──unshare_itinerary──▶ draft
--   `shared_at` se fija al compartir y vuelve a NULL al dejar de compartir. No se usa published_at ni nada contractual.
--
-- QUÉ HACE
--   1) can_travel(kind, acción) gana la acción 'compartir' (SOLO itinerario): admin, editor y staff; la Asesora solo lo suyo
--      (ownership con is_own_or_full, como en el resto). Para una propuesta 'compartir' sigue siendo false. El resto, idéntico a 0055.
--   2) private.itinerary_share_problems(id, para_correo): la lista de pendientes, calculada en la base. NO mira precios, términos,
--      aceptación, elecciones ni comentarios de cotización: solo cliente, destino, portada, recorrido utilizable, acceso y vigencia.
--   3) public.get_itinerary_share_readiness(id, para_correo): la misma lista, con autorización (can_travel + ownership).
--   4) public.share_itinerary(id): draft → shared con la lista de pendientes REVISADA EN EL SERVIDOR; fija shared_at; asegura
--      public_token; conserva access_required, código y vigencia. Idempotente: compartir algo ya compartido no cambia nada.
--   5) public.unshare_itinerary(id): shared | viewed → draft, shared_at = NULL y REVOCA todas las sesiones de acceso; conserva
--      contenido y documentos. Idempotente. Desde ese momento el enlace deja de entregar contenido y documentos.
--   6) Auditoría: log_proposal_status_change distingue las transiciones de un itinerario (itinerary_shared / itinerary_unshared;
--      la visualización sigue siendo itinerary_status_changed). La rama de propuestas queda EXACTAMENTE como en 0055.
--
-- QUÉ NO HACE: el correo (Edge send-itinerary, se audita allí como itinerary_email_sent), WhatsApp (se abre desde el navegador y
--   no se audita), la vista privada (frontend). No cambia publish_proposal, unpublish_proposal ni las RPC de acceso: get_proposal_gate,
--   verify_proposal_access y get_proposal_content ya entregan un itinerario solo en shared | viewed y lo proyectan sin lo contractual.
--
-- ORDEN DE DESPLIEGUE: aplicar ANTES de desplegar send-itinerary y el frontend (llaman a estas RPC).
--
-- Aplicar con: supabase db query --linked -f supabase/migrations/0056_itinerary_sharing.sql
-- Verificar (solo lectura): supabase db query --linked -f supabase/migration-scripts/0056_itinerary_sharing_verify.sql
-- Revertir (a mano): supabase db query --linked -f supabase/migration-scripts/0056_itinerary_sharing_rollback.sql
begin;

do $$
begin
  if to_regprocedure('public.can_travel(text, text)') is null
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proposals' and column_name = 'shared_at')
     or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'proposals' and column_name = 'kind') then
    raise exception '0056 requiere 0055 (proposals.kind, proposals.shared_at y can_travel) aplicada antes';
  end if;
end $$;

-- ------------------------------------------------------------------
-- 1) can_travel: la acción 'compartir' (solo itinerario). Igual que 0055 salvo la rama nueva.
-- ------------------------------------------------------------------
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
    when p_kind = 'itinerary' and p_action = 'compartir'
      then private.app_user_role() in ('admin', 'editor', 'staff')
    else false
  end
$$;

-- ------------------------------------------------------------------
-- 2) Pendientes para compartir. Mismo formato que la lista de pendientes de publicación del panel
--    (position, code, message, tab, day_id, service_id, line_id), para reutilizar la misma pantalla.
--    Interna: sin EXECUTE para nadie salvo el dueño; solo la llaman las RPC SECURITY DEFINER de abajo.
-- ------------------------------------------------------------------
create or replace function private.itinerary_share_problems(p_id uuid, p_for_email boolean default false)
returns table (
  "position" integer,
  code text,
  message text,
  tab text,
  day_id text,
  service_id text,
  line_id text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v public.proposals%rowtype;
  v_pos integer := 0;
  v_has_code boolean;
begin
  select p.* into v from public.proposals p where p.id = p_id and p.kind = 'itinerary';
  if not found then
    return;
  end if;

  -- Solo un borrador se comparte: si ya está compartido o visto no hay nada que completar.
  if v.status <> 'draft' then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'invalid_status'; message := 'El itinerario ya está compartido.'; tab := 'client-trip';
    day_id := null; service_id := null; line_id := null;
    return next;
    return;
  end if;

  if coalesce(trim(v.client_name), '') = '' then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'client_name_missing'; message := 'Datos del viaje: falta el nombre del cliente.'; tab := 'client-trip';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;

  if p_for_email then
    if coalesce(trim(v.client_email), '') = '' then
      v_pos := v_pos + 1;
      "position" := v_pos; code := 'client_email_missing'; message := 'Datos del viaje: falta el correo del cliente (necesario para enviarlo por correo).'; tab := 'client-trip';
      day_id := null; service_id := null; line_id := null;
      return next;
    elsif trim(v.client_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
      v_pos := v_pos + 1;
      "position" := v_pos; code := 'client_email_invalid'; message := 'Datos del viaje: el correo del cliente no es válido.'; tab := 'client-trip';
      day_id := null; service_id := null; line_id := null;
      return next;
    end if;
  end if;

  if coalesce(trim(v.destination_text), '') = '' then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'destination_missing'; message := 'Datos del viaje: falta el destino.'; tab := 'client-trip';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;

  if v.start_date is not null and v.end_date is not null and v.end_date < v.start_date then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'dates_inverted'; message := 'Datos del viaje: la fecha de fin es anterior a la de inicio.'; tab := 'client-trip';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;

  if coalesce(trim(v.title), '') = '' then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'cover_title_missing'; message := 'Portada: falta el título.'; tab := 'cover';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;

  if coalesce(jsonb_typeof(v.content -> 'days'), '') <> 'array' or jsonb_array_length(coalesce(v.content -> 'days', '[]'::jsonb)) = 0 then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'days_missing'; message := 'Itinerario: agrega al menos un día.'; tab := 'journey';
    day_id := null; service_id := null; line_id := null;
    return next;
  elsif not jsonb_path_exists(v.content, '$.days[*].services[*]') then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'services_missing'; message := 'Itinerario: agrega al menos un servicio a algún día.'; tab := 'journey';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;

  if v.access_required then
    select exists (
      select 1 from public.proposal_access_credentials c
       where c.proposal_id = p_id and c.access_code_hash is not null and length(c.access_code_hash) > 0
    ) into v_has_code;
    if not v_has_code then
      v_pos := v_pos + 1;
      "position" := v_pos; code := 'access_code_missing'; message := 'Acceso: falta generar el código de acceso.'; tab := 'client-trip';
      day_id := null; service_id := null; line_id := null;
      return next;
    end if;
  end if;

  if v.expires_at is not null and v.expires_at <= now() then
    v_pos := v_pos + 1;
    "position" := v_pos; code := 'expiry_in_past'; message := 'Acceso: la fecha de expiración ya pasó.'; tab := 'client-trip';
    day_id := null; service_id := null; line_id := null;
    return next;
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- 3) get_itinerary_share_readiness: la lista, con autorización.
-- ------------------------------------------------------------------
create or replace function public.get_itinerary_share_readiness(p_id uuid, p_for_email boolean default false)
returns table (
  "position" integer,
  code text,
  message text,
  tab text,
  day_id text,
  service_id text,
  line_id text
)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text;
  v_advisor uuid;
begin
  select p.kind, p.advisor_id into v_kind, v_advisor from public.proposals p where p.id = p_id;

  if not found then
    raise exception 'Itinerario no encontrado';
  end if;
  if v_kind <> 'itinerary' then
    raise exception 'kind_not_supported: solo un itinerario tiene lista de pendientes para compartir';
  end if;
  if not public.can_travel(v_kind, 'compartir') then
    raise exception 'No autorizado';
  end if;
  if not public.is_own_or_full(v_advisor) then
    raise exception 'No autorizado: este itinerario pertenece a otra asesora';
  end if;

  return query select * from private.itinerary_share_problems(p_id, coalesce(p_for_email, false)) order by 1;
end;
$$;

-- ------------------------------------------------------------------
-- 4) share_itinerary: draft → shared.
-- ------------------------------------------------------------------
create or replace function public.share_itinerary(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v public.proposals%rowtype;
  v_problems text;
begin
  select p.* into v from public.proposals p where p.id = p_id;

  if not found then
    raise exception 'Itinerario no encontrado';
  end if;
  -- Solo itinerarios (guard explícito, no depende de un CHECK).
  if v.kind <> 'itinerary' then
    raise exception 'kind_not_supported: solo se puede compartir un itinerario';
  end if;
  if not public.can_travel(v.kind, 'compartir') then
    raise exception 'No autorizado';
  end if;
  -- La Asesora (staff) solo comparte SUS itinerarios (admin y editor, cualquiera).
  if not public.is_own_or_full(v.advisor_id) then
    raise exception 'No autorizado: este itinerario pertenece a otra asesora';
  end if;

  -- Idempotente: ya compartido o visto → no cambia nada (ni shared_at).
  if v.status in ('shared', 'viewed') then
    return;
  end if;
  if v.status <> 'draft' then
    raise exception 'Solo se puede compartir un itinerario en estado draft';
  end if;

  -- Los pendientes se revisan AQUÍ, en el servidor: lo que muestre la pantalla es solo una ayuda.
  select string_agg(pr.message, '; ' order by pr."position") into v_problems
    from private.itinerary_share_problems(p_id, false) pr;
  if v_problems is not null then
    raise exception 'Faltan datos para compartir: %', v_problems;
  end if;

  update public.proposals
     set status = 'shared',
         shared_at = now(),
         public_token = coalesce(public_token, gen_random_uuid())
   where id = p_id and kind = 'itinerary' and status = 'draft';

  if not found then
    -- Otra operación lo cambió entre la lectura y la escritura: si quedó compartido, es el resultado pedido.
    if not exists (select 1 from public.proposals where id = p_id and status in ('shared', 'viewed')) then
      raise exception 'No se pudo compartir el itinerario: su estado cambió. Inténtalo de nuevo.';
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------------
-- 5) unshare_itinerary: shared | viewed → draft, y revoca el acceso.
-- ------------------------------------------------------------------
create or replace function public.unshare_itinerary(p_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_kind text;
  v_advisor uuid;
begin
  select p.kind, p.advisor_id into v_kind, v_advisor from public.proposals p where p.id = p_id;

  if not found then
    raise exception 'Itinerario no encontrado';
  end if;
  if v_kind <> 'itinerary' then
    raise exception 'kind_not_supported: solo se puede dejar de compartir un itinerario';
  end if;
  if not public.can_travel(v_kind, 'compartir') then
    raise exception 'No autorizado';
  end if;
  if not public.is_own_or_full(v_advisor) then
    raise exception 'No autorizado: este itinerario pertenece a otra asesora';
  end if;

  -- El contenido y los documentos no se tocan. viewed_at se limpia: un nuevo ciclo empieza sin visualización previa.
  update public.proposals
     set status = 'draft',
         shared_at = null,
         viewed_at = null
   where id = p_id and kind = 'itinerary' and status in ('shared', 'viewed');

  -- Revocar INMEDIATAMENTE toda sesión emitida (también si ya estaba en borrador: la limpieza es idempotente).
  delete from public.proposal_access_sessions where proposal_id = p_id;
end;
$$;

-- ------------------------------------------------------------------
-- 6) Auditoría: textos y acciones propios de cada transición de un itinerario. La rama de propuestas es la de 0055, tal cual.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_proposal_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_summary text;
  v_action text;
begin

  -- Itinerario: una acción por transición (compartir / dejar de compartir); la visualización conserva itinerary_status_changed.
  if new.kind = 'itinerary' then
    v_summary := case new.status
      when 'shared' then 'Compartió el itinerario para "' || new.client_name || '"'
      when 'viewed' then 'El cliente visualizó el itinerario para "' || new.client_name || '"'
      when 'draft' then 'Dejó de compartir el itinerario para "' || new.client_name || '"'
      else 'Actualizó el estado del itinerario para "' || new.client_name || '"'
    end;
    v_action := case
      when new.status = 'shared' then 'itinerary_shared'
      when new.status = 'draft' and old.status in ('shared', 'viewed') then 'itinerary_unshared'
      else 'itinerary_status_changed'
    end;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (auth.uid(), v_action, 'itinerary', new.id::text, v_summary);
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

-- ------------------------------------------------------------------
-- 7) Privilegios. El helper no lo ejecuta nadie directamente; las RPC solo las ejecuta quien está autenticado (y service_role).
-- ------------------------------------------------------------------
revoke all on function private.itinerary_share_problems(uuid, boolean) from public, anon, authenticated;

revoke execute on function public.get_itinerary_share_readiness(uuid, boolean) from public, anon;
revoke execute on function public.share_itinerary(uuid) from public, anon;
revoke execute on function public.unshare_itinerary(uuid) from public, anon;
grant execute on function public.get_itinerary_share_readiness(uuid, boolean) to authenticated;
grant execute on function public.share_itinerary(uuid) to authenticated;
grant execute on function public.unshare_itinerary(uuid) to authenticated;

commit;
