-- Módulo: Smart Proposal Builder — Premium Client Proposal Experience.
--
-- get_proposal_content() (0031) nunca exponía destination_text/start_date/
-- end_date/travelers_count/client_name — solo `content` (el JSONB de
-- cover/intro/days/pricing/terms). La vista pública nueva necesita mostrar
-- destino/fechas/viajeros en el hero y el resumen del viaje, y ese dato vive
-- en columnas de `proposals`, no en `content`. Cambio aditivo y acotado,
-- solicitado explícitamente: SOLO se toca get_proposal_content() (requiere
-- sesión ya válida — nunca antes del código), get_proposal_gate() queda
-- intacto a propósito para no revelar nada antes de verificar el acceso.
--
-- El cambio de forma de RETURNS TABLE obliga a DROP + CREATE (no alcanza con
-- CREATE OR REPLACE) — mismo patrón ya usado en 0035 para
-- verify_proposal_access(). Los grants se reponen al final.
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
  travelers_count   int
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
           p.client_name, p.destination_text, p.start_date, p.end_date, p.travelers_count
    from proposals p
    where p.id = v_proposal_id;
end;
$$;

revoke execute on function get_proposal_content(uuid, uuid) from public;
grant execute on function get_proposal_content(uuid, uuid) to anon, authenticated;
