-- Módulo: Smart Proposal Builder — la "sonda" de la página pública ya no cuenta como intento fallido.
--
-- La página del cliente llama a verify_proposal_access(token, null) cada vez que se abre, solo para
-- saber si la propuesta tiene un código configurado (antes de mostrar el campo). Esa llamada contaba
-- como intento fallido: tras 5 aperturas sin entrar, el acceso quedaba bloqueado 15 minutos (el
-- bloqueo es por propuesta, no por visitante). Aquí un código vacío o nulo devuelve 'invalid_code'
-- SIN sumar intentos. No cambia la protección contra adivinar códigos: un código escrito y
-- equivocado sigue sumando y bloqueando igual.
--
-- Solo cambia verify_proposal_access (misma firma, mismo retorno, mismos permisos).
begin;

create or replace function public.verify_proposal_access(p_token uuid, p_access_code text default null::text)
returns table (result text, session_token uuid, session_expires_at timestamp with time zone)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal_id uuid;
  v_access_required boolean;
  v_expired boolean;

  v_access_code_hash text;
  v_access_attempts integer;
  v_access_locked_until timestamptz;

  v_session_token uuid;
  v_session_expires_at timestamptz;
begin

  select
    p.id,
    p.access_required,
    (p.expires_at is not null and p.expires_at <= now())
  into
    v_proposal_id,
    v_access_required,
    v_expired
  from public.proposals p
  where p.public_token = p_token
    and p.status in (
      'published',
      'viewed',
      'accepted'
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


  -- Vencido: el enlace abre, pero no se emite sesión ni se prueba el código (no cuenta como intento).
  if v_expired then
    return query
      select
        'expired'::text,
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


  -- Código vacío = la "sonda" de la página pública (comprueba si hay un código configurado antes de
  -- mostrar el campo): NO es un intento de adivinar y no cuenta. Antes contaba como fallido, así que
  -- cinco aperturas del enlace sin entrar bloqueaban el acceso 15 minutos.
  if p_access_code is null or btrim(p_access_code) = '' then
    return query
      select
        'invalid_code'::text,
        null::uuid,
        null::timestamptz;

    return;
  end if;


  if extensions.crypt(
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

-- search_path vacío en las otras cuatro funciones públicas (sus cuerpos ya están calificados).
alter function public.get_proposal_content(uuid, uuid) set search_path = '';
alter function public.accept_proposal(uuid, uuid, text) set search_path = '';
alter function public.set_proposal_service_choice(uuid, uuid, text, boolean) set search_path = '';
alter function public.set_proposal_service_comment(uuid, uuid, text, text) set search_path = '';

commit;
