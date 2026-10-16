-- Módulo: Smart Proposal Builder — el cliente puede dejar un comentario o
-- pedir cambios en cada servicio del itinerario (hotel, traslado, actividad…),
-- sobre todo cuando no lo marca con "Sí, por favor". El comentario NO cambia
-- el total de la propuesta: el total siempre suma todo lo cotizado.
--
-- Los comentarios viven en proposals.service_comments como un objeto
-- { "<service_id>": "texto" }, igual que service_choices (0043). Esta
-- migración es autosuficiente: crea service_choices si todavía no existe (por
-- si 0043 no se aplicó) y redefine get_proposal_content() con ambas columnas.
--
-- Igual que el resto de las RPC públicas (ver 0031/0043), exige una sesión
-- válida emitida por verify_proposal_access(): el token de la URL solo no
-- alcanza.
alter table proposals
  add column if not exists service_choices jsonb not null default '{}'::jsonb;

alter table proposals
  add column if not exists service_comments jsonb not null default '{}'::jsonb;

-- Un comentario vacío borra el existente. Solo se puede comentar mientras la
-- propuesta siga abierta (published/viewed); una vez 'accepted' queda fijo.
create or replace function set_proposal_service_comment(
  p_token uuid,
  p_session_token uuid,
  p_service_id text,
  p_comment text
)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_proposal_id uuid;
  v_comment text := trim(coalesce(p_comment, ''));
begin
  select p.id into v_proposal_id
    from proposal_access_sessions s
    join proposals p on p.id = s.proposal_id
    where s.id = p_session_token
      and p.public_token = p_token
      and s.expires_at > now()
      and p.status in ('published', 'viewed')
      and (p.expires_at is null or p.expires_at > now());

  if v_proposal_id is null then
    raise exception 'session_invalid';
  end if;

  if length(v_comment) > 1000 then
    raise exception 'comment_too_long';
  end if;

  -- Solo ids de servicios que existen en el contenido (misma defensa que
  -- set_proposal_service_choice en 0043).
  if not exists (
    select 1
    from proposals p,
         jsonb_array_elements(coalesce(p.content->'days', '[]'::jsonb)) as d,
         jsonb_array_elements(coalesce(d->'services', '[]'::jsonb)) as sv
    where p.id = v_proposal_id
      and sv->>'id' = p_service_id
  ) then
    raise exception 'service_not_found';
  end if;

  if v_comment = '' then
    update proposals
      set service_comments = service_comments - p_service_id
      where proposals.id = v_proposal_id;
  else
    update proposals
      set service_comments = jsonb_set(service_comments, array[p_service_id], to_jsonb(v_comment), true)
      where proposals.id = v_proposal_id;
  end if;
end;
$$;

revoke execute on function set_proposal_service_comment(uuid, uuid, text, text) from public;
grant execute on function set_proposal_service_comment(uuid, uuid, text, text) to anon, authenticated;

-- get_proposal_content() ahora también devuelve service_comments — cambia la
-- forma de RETURNS TABLE, así que DROP + CREATE y se repiten los grants.
drop function if exists get_proposal_content(uuid, uuid);

create function get_proposal_content(p_token uuid, p_session_token uuid)
returns table (
  content           jsonb,
  pricing_subtotal  numeric,
  pricing_fees      numeric,
  pricing_total     numeric,
  currency          text,
  status            text,
  terms_accepted    boolean,
  accepted_at       timestamptz,
  client_name       text,
  destination_text  text,
  start_date        date,
  end_date          date,
  travelers_count   int,
  service_choices   jsonb,
  service_comments  jsonb
)
language plpgsql security definer set search_path = public as $$
declare
  v_proposal_id uuid;
begin
  select p.id into v_proposal_id
    from proposal_access_sessions s
    join proposals p on p.id = s.proposal_id
    where s.id = p_session_token
      and p.public_token = p_token
      and s.expires_at > now()
      and p.status in ('published', 'viewed', 'accepted')
      and (p.expires_at is null or p.expires_at > now());

  if v_proposal_id is null then
    raise exception 'session_invalid';
  end if;

  update proposal_access_sessions set last_seen_at = now() where id = p_session_token;

  update proposals set status = 'viewed', viewed_at = now()
    where proposals.id = v_proposal_id and proposals.status = 'published';

  return query
    select p.content, p.pricing_subtotal, p.pricing_fees, p.pricing_total,
           p.currency, p.status, p.terms_accepted, p.accepted_at,
           p.client_name, p.destination_text, p.start_date, p.end_date, p.travelers_count,
           p.service_choices, p.service_comments
    from proposals p
    where p.id = v_proposal_id;
end;
$$;

revoke execute on function get_proposal_content(uuid, uuid) from public;
grant execute on function get_proposal_content(uuid, uuid) to anon, authenticated;
