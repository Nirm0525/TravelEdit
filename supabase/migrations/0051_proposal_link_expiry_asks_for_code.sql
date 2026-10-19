-- Módulo: Smart Proposal Builder — el enlace público nunca queda "muerto".
--
-- Decisión: pasada la fecha de expiración (proposals.expires_at), el enlace SIGUE abriendo y
-- muestra la pantalla de acceso, pero el código deja de servir: el cliente ve "tu acceso venció,
-- pide a tu asesora que lo renueve". La asesora renueva cambiando la fecha de expiración (y,
-- si quiere, el código). Antes, pasada la fecha, el cliente solo veía "no disponible".
--
-- Qué cambia (solo estas dos funciones; get_proposal_content/accept_proposal/elecciones/comentarios
-- siguen exigiendo una propuesta vigente, así que una sesión abierta muere al vencer):
--   1) get_proposal_gate: ya no filtra por expiración; devuelve status = 'expired' cuando venció.
--   2) verify_proposal_access: pasada la fecha devuelve result = 'expired' (sin comprobar el código,
--      sin gastar intentos y sin crear sesión).
--
-- ARREGLO IMPORTANTE (deriva con producción): get_proposal_gate en producción NO es SECURITY DEFINER
-- (0042 lo define así, pero la base tiene otra versión). Como visitante (anon) fallaba con
-- "permission denied for table proposals": ningún enlace público podía abrirse. Aquí se recrea como
-- SECURITY DEFINER, igual que 0042 y que el resto de las funciones públicas. Solo expone lo mínimo
-- para pintar la pantalla de acceso (cliente, título, portada, estado), nunca el contenido.
--
-- search_path vacío: las seis funciones que usa la página pública (gate, verificación del código,
-- contenido, aceptación, elecciones y comentarios por servicio) quedan SECURITY DEFINER con
-- search_path = ''. Gate y verificación se reescriben aquí con nombres calificados; las otras cuatro ya
-- están totalmente calificadas (public.x / extensions.x) en producción, así que solo se cambia la opción.
--
-- Mismas firmas y mismos tipos de retorno: CREATE OR REPLACE conserva los GRANT existentes
-- (anon, authenticated, service_role).
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
security definer
set search_path = ''
as $$
  select
    p.access_required,
    p.client_name,
    p.title,
    p.cover_image_path,
    case
      when p.expires_at is not null and p.expires_at <= now() then 'expired'
      else p.status
    end
  from public.proposals p
  where p.public_token = p_token
    and p.status in ('published', 'viewed', 'accepted')
$$;

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

-- search_path vacío en las otras cuatro funciones públicas (sus cuerpos ya están calificados).
alter function public.get_proposal_content(uuid, uuid) set search_path = '';
alter function public.accept_proposal(uuid, uuid, text) set search_path = '';
alter function public.set_proposal_service_choice(uuid, uuid, text, boolean) set search_path = '';
alter function public.set_proposal_service_comment(uuid, uuid, text, text) set search_path = '';

-- Permisos: solo visitantes (anon) y asesoras con sesión (authenticated); PUBLIC no. En producción
-- get_proposal_gate sí era ejecutable por PUBLIC (verify_proposal_access no); se deja igual que 0031/0036.
revoke execute on function public.get_proposal_gate(uuid) from public;
revoke execute on function public.verify_proposal_access(uuid, text) from public;
grant execute on function public.get_proposal_gate(uuid) to anon, authenticated;
grant execute on function public.verify_proposal_access(uuid, text) to anon, authenticated;

commit;
