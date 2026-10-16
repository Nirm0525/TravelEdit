-- Módulo: Smart Proposal Builder — el cliente puede aceptar, servicio por
-- servicio, lo que se le propone en cada día del itinerario (botón "Sí, por
-- favor" en la propuesta pública).
--
-- Las elecciones viven en proposals.service_choices como un objeto
-- { "<service_id>": true|false } — la clave es el id del servicio dentro de
-- content.days[].services[]. No se agrega una tabla aparte: son pocas claves
-- por propuesta, siempre se leen junto con el contenido y no se consultan de
-- forma independiente.
--
-- El token de la URL nunca alcanza por sí solo (ver 0031): igual que
-- get_proposal_content()/accept_proposal(), la nueva función exige una sesión
-- válida emitida por verify_proposal_access().
alter table proposals
  add column if not exists service_choices jsonb not null default '{}'::jsonb;

-- Las elecciones solo se pueden cambiar mientras la propuesta siga abierta:
-- una vez 'accepted' quedan fijas (status 'accepted' queda fuera del filtro).
create or replace function set_proposal_service_choice(
  p_token uuid,
  p_session_token uuid,
  p_service_id text,
  p_accepted boolean
)
returns void
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
      and p.status in ('published', 'viewed')
      and (p.expires_at is null or p.expires_at > now());

  if v_proposal_id is null then
    raise exception 'session_invalid';
  end if;

  -- Solo ids de servicios que realmente existen en el contenido: evita que
  -- un cliente (o un script con una sesión válida) llene la columna de claves
  -- arbitrarias.
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

  update proposals
    set service_choices = jsonb_set(service_choices, array[p_service_id], to_jsonb(p_accepted), true)
    where proposals.id = v_proposal_id;
end;
$$;

revoke execute on function set_proposal_service_choice(uuid, uuid, text, boolean) from public;
grant execute on function set_proposal_service_choice(uuid, uuid, text, boolean) to anon, authenticated;

-- get_proposal_content() devuelve ahora también service_choices. Cambia la
-- forma de RETURNS TABLE, así que DROP + CREATE (mismo motivo documentado en
-- 0035/0039) y se repiten los grants. El cuerpo es el de 0040 (referencias
-- calificadas a proposals.id/status) más la columna nueva.
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
  service_choices   jsonb
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
           p.service_choices
    from proposals p
    where p.id = v_proposal_id;
end;
$$;

revoke execute on function get_proposal_content(uuid, uuid) from public;
grant execute on function get_proposal_content(uuid, uuid) to anon, authenticated;
