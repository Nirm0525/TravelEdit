-- Reversión de 0051: restaura las definiciones que tenía producción antes de la 0051.
-- ATENCIÓN: la versión anterior de get_proposal_gate NO es SECURITY DEFINER y falla para visitantes
-- (anon) con "permission denied for table proposals": volver a ella deja los enlaces públicos sin abrir.
-- Úsala solo si la 0051 causara un problema peor.
begin;

create or replace function public.get_proposal_gate(p_token uuid)
returns table (
  access_required   boolean,
  client_name       text,
  cover_title       text,
  cover_image_path  text,
  status            text
)
language sql
stable
set search_path = public
as $$
  select p.access_required, p.client_name, p.title, p.cover_image_path, p.status
  from proposals p
  where p.public_token = p_token
    and p.status in ('published', 'viewed', 'accepted')
    and (p.expires_at is null or p.expires_at > now())
$$;

create or replace function public.verify_proposal_access(p_token uuid, p_access_code text default null::text)
returns table (result text, session_token uuid, session_expires_at timestamp with time zone)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_proposal_id uuid;
  v_access_required boolean;

  v_access_code_hash text;
  v_access_attempts integer;
  v_access_locked_until timestamptz;

  v_session_token uuid;
  v_session_expires_at timestamptz;
begin

  select
    p.id,
    p.access_required
  into
    v_proposal_id,
    v_access_required
  from public.proposals p
  where p.public_token = p_token
    and p.status in (
      'published',
      'viewed',
      'accepted'
    )
    and (
      p.expires_at is null
      or p.expires_at > now()
    )
  limit 1;


  if v_proposal_id is null then
    return query
      select
        'not_found'::text,
        null::uuid,
        null::timestamptz;
    return;
  end if;


  if not v_access_required then

    insert into public.proposal_access_sessions (
      proposal_id
    )
    values (
      v_proposal_id
    )
    returning
      id,
      expires_at
    into
      v_session_token,
      v_session_expires_at;

    return query
      select
        'ok'::text,
        v_session_token,
        v_session_expires_at;

    return;
  end if;


  select
    c.access_code_hash,
    c.access_attempts,
    c.access_locked_until
  into
    v_access_code_hash,
    v_access_attempts,
    v_access_locked_until
  from public.proposal_access_credentials c
  where c.proposal_id = v_proposal_id;


  if v_access_code_hash is null then
    return query
      select
        'access_not_configured'::text,
        null::uuid,
        null::timestamptz;
    return;
  end if;


  if v_access_locked_until is not null
     and v_access_locked_until > now() then

    return query
      select
        'locked'::text,
        null::uuid,
        null::timestamptz;

    return;
  end if;


  if p_access_code is null
     or extensions.crypt(
       p_access_code,
       v_access_code_hash
     ) <> v_access_code_hash then

    update public.proposal_access_credentials c
    set
      access_attempts = c.access_attempts + 1,
      access_locked_until =
        case
          when c.access_attempts + 1 >= 5
            then now() + interval '15 minutes'
          else null
        end
    where c.proposal_id = v_proposal_id;

    return query
      select
        'invalid_code'::text,
        null::uuid,
        null::timestamptz;

    return;
  end if;


  update public.proposal_access_credentials c
  set
    access_attempts = 0,
    access_locked_until = null
  where c.proposal_id = v_proposal_id;


  insert into public.proposal_access_sessions (
    proposal_id
  )
  values (
    v_proposal_id
  )
  returning
    id,
    expires_at
  into
    v_session_token,
    v_session_expires_at;


  return query
    select
      'ok'::text,
      v_session_token,
      v_session_expires_at;

end;
$$;

-- search_path anterior de las otras cuatro funciones (el que tenían en producción).
alter function public.get_proposal_content(uuid, uuid) set search_path = public;
alter function public.accept_proposal(uuid, uuid, text) set search_path = public, pg_temp;
alter function public.set_proposal_service_choice(uuid, uuid, text, boolean) set search_path = public;
alter function public.set_proposal_service_comment(uuid, uuid, text, text) set search_path = public;

commit;
