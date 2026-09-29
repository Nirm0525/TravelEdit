-- Módulo: Smart Proposal Builder — corrige un bug real encontrado en QA real
-- justo después de 0039: la función quedó desplegada con
-- "where id = v_proposal_id and status = 'published'" (id/status SIN
-- calificar) en el UPDATE de proposals, en vez de "proposals.id"/
-- "proposals.status". Con una columna de salida llamada `status` en
-- RETURNS TABLE, PL/pgSQL declara una variable implícita `status` en todo
-- el cuerpo de la función — la referencia sin calificar es ambigua entre
-- esa variable y la columna real, y Postgres la rechaza en tiempo de
-- ejecución con 42702 ("column reference is ambiguous"), no en tiempo de
-- creación de la función (por eso no se vio hasta la primera llamada real).
-- Mismo bug documentado ya una vez en 0031 para esta misma función — CREATE
-- OR REPLACE alcanza acá porque la firma/forma de RETURNS TABLE no cambia,
-- solo se corrige el cuerpo.
create or replace function get_proposal_content(p_token uuid, p_session_token uuid)
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
