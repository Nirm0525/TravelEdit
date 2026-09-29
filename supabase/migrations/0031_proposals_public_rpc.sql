-- Módulo: Smart Proposal Builder — acceso público (anon), vía RPC.
--
-- RLS de `proposals`/`proposal_access_sessions` queda completamente cerrada
-- para anon (ver 0029/0030) a propósito: el acceso público NUNCA se resuelve
-- con una policy "using (status = 'published')", porque eso expondría TODAS
-- las propuestas publicadas a cualquier anónimo que consulte la tabla sin
-- filtro por token — RLS no puede verificar que el cliente conoce el token,
-- solo que la fila cumple la condición. En su lugar, cada función de abajo
-- recibe el token (y, para leer contenido, el session_token) como parámetro
-- explícito y decide server-side qué devolver — mismo mecanismo de
-- `security definer` + `grant execute to anon` que ya usa este proyecto para
-- is_staff()/can_manage_content() (0012/0022/0028), aplicado ahora a
-- funciones que además reciben argumentos en vez de solo leer auth.uid().
--
-- Flujo: get_proposal_gate (sin código, solo para pintar la pantalla de
-- acceso) -> verify_proposal_access (token + código, emite sesión) ->
-- get_proposal_content (token + sesión, ahí sí devuelve `content` completo)
-- -> accept_proposal (token + sesión).
--
-- Nota de contrato para el cliente (Angular, fuera de esta fase):
-- verify_proposal_access() NUNCA lanza una excepción de Postgres para un
-- fallo esperado (código incorrecto, bloqueado, token no encontrado) — ver
-- el porqué en su comentario. Siempre devuelve una fila con `error_code`
-- (null en éxito). get_proposal_content()/accept_proposal() sí lanzan
-- ('session_invalid', etc.) porque no tienen un efecto secundario previo que
-- proteger de un rollback — el cliente debe manejar ambos contratos
-- distinto: leer error_code en la primera, capturar el error en las otras.

-- ------------------------------------------------------------------
-- get_proposal_gate: lo mínimo para pintar "Hola, {cliente} — ingresa tu
-- código de acceso", sin revelar itinerario, pricing ni ningún dato del
-- viaje. Devuelve cero filas si el token no existe, la propuesta está en
-- draft (nunca alcanzable externamente) o ya expiró — a propósito no se
-- distingue un caso de otro en la respuesta, para no dar pistas.
-- ------------------------------------------------------------------
create function get_proposal_gate(p_token uuid)
returns table (
  access_required   boolean,
  client_name       text,
  cover_title       text,
  cover_image_path  text,
  status            text
)
language sql stable security definer set search_path = public as $$
  select p.access_required, p.client_name, p.title, p.cover_image_path, p.status
  from proposals p
  where p.public_token = p_token
    and p.status in ('published', 'viewed', 'accepted')
    and (p.expires_at is null or p.expires_at > now())
$$;

-- ------------------------------------------------------------------
-- verify_proposal_access: valida token + código, emite una sesión efímera.
-- Bloqueo global por propuesta tras 5 intentos fallidos (ver comentario de
-- access_attempts/access_locked_until en 0029) — 15 minutos, sin distinguir
-- IP ni dispositivo en este MVP.
--
-- Devuelve error_code en vez de RAISE EXCEPTION para cualquier fallo
-- esperado ("not_found"/"locked"/"invalid_code", session_token null en los
-- tres casos) — NO es solo estilo: un RAISE EXCEPTION sin capturar aborta
-- todo el statement que invocó a esta función, y con él CUALQUIER UPDATE
-- que la función ya haya hecho antes de llegar al raise. La primera versión
-- de esta función incrementaba access_attempts y LUEGO hacía
-- "raise exception 'invalid_code'" — ese mismo raise deshacía el UPDATE que
-- lo precedía, así que access_attempts nunca pasaba de 0 y el bloqueo de 5
-- intentos jamás se disparaba (confirmado con una réplica real de las
-- migraciones: 5 intentos fallidos seguidos, access_attempts seguía en 0).
-- Retornando la fila normalmente en vez de lanzar, el UPDATE sí queda
-- confirmado como parte de un statement exitoso.
-- ------------------------------------------------------------------
create function verify_proposal_access(p_token uuid, p_access_code text default null)
returns table (session_token uuid, session_expires_at timestamptz, error_code text)
language plpgsql security definer set search_path = public as $$
declare
  v_proposal proposals%rowtype;
begin
  select * into v_proposal
    from proposals
    where public_token = p_token
      and status in ('published', 'viewed', 'accepted')
      and (proposals.expires_at is null or proposals.expires_at > now());

  if not found then
    return query select null::uuid, null::timestamptz, 'not_found'::text;
    return;
  end if;

  if v_proposal.access_locked_until is not null then
    if v_proposal.access_locked_until > now() then
      return query select null::uuid, null::timestamptz, 'locked'::text;
      return;
    else
      -- El bloqueo ya venció por tiempo, pero access_attempts nunca baja
      -- solo — sin este reset, el primer intento fallido después del
      -- bloqueo volvería a disparar el lock instantáneo (access_attempts
      -- seguía en 5+, así que access_attempts + 1 >= 5 ya era cierto de
      -- entrada). Se limpia acá para que arranque un contador nuevo de 5.
      update proposals set access_attempts = 0, access_locked_until = null where id = v_proposal.id;
    end if;
  end if;

  if v_proposal.access_required then
    if p_access_code is null
       or v_proposal.access_code_hash is null
       or extensions.crypt(p_access_code, v_proposal.access_code_hash) <> v_proposal.access_code_hash then
      update proposals
        set access_attempts = access_attempts + 1,
            access_locked_until = case
              when access_attempts + 1 >= 5 then now() + interval '15 minutes'
              else access_locked_until
            end
        where id = v_proposal.id;
      return query select null::uuid, null::timestamptz, 'invalid_code'::text;
      return;
    end if;

    update proposals set access_attempts = 0, access_locked_until = null where id = v_proposal.id;
  end if;

  return query
    with new_session as (
      insert into proposal_access_sessions (proposal_id)
      values (v_proposal.id)
      returning id, expires_at
    )
    select new_session.id, new_session.expires_at, null::text from new_session;
end;
$$;

-- ------------------------------------------------------------------
-- get_proposal_content: requiere sesión válida, no solo el token. Revalida
-- también el estado/expiración de la PROPUESTA (no solo de la sesión): si la
-- propuesta se despublicó o expiró después de emitida la sesión, esta
-- llamada falla igual aunque la fila de sesión en sí todavía no haya
-- expirado — es la revocación "perezosa" para el caso de expiración por
-- tiempo (no hay un evento que disparar; unpublish_proposal() y
-- set_proposal_access_code(), en cambio, SÍ borran la sesión de inmediato,
-- ver 0032_proposals_admin_rpc.sql).
--
-- IMPORTANTE (para cuando se construya la vista pública, fuera de esta
-- fase): `content` viaja tal cual fue guardado por el admin — TipTap y
-- OpenAI pueden producir HTML, y este RPC NO lo sanea. Sanear antes de
-- renderizar es responsabilidad de la capa pública (reutilizar el
-- sanitizador ya existente en el sitio, src/app/core/utils/sanitize-rich-html.ts),
-- nunca asumir que `content` ya llega limpio.
-- ------------------------------------------------------------------
create function get_proposal_content(p_token uuid, p_session_token uuid)
returns table (
  content           jsonb,
  pricing_subtotal  numeric,
  pricing_fees      numeric,
  pricing_total     numeric,
  currency          text,
  status            text,
  terms_accepted    boolean,
  accepted_at       timestamptz
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

  -- `status`/`id` deben ir calificados con `proposals.` aquí: esta función
  -- devuelve una columna de salida llamada `status` (parte de RETURNS
  -- TABLE), y un identificador sin calificar dentro del cuerpo de la
  -- función es ambiguo entre esa variable implícita y la columna real de la
  -- tabla — Postgres lo rechaza con "column reference is ambiguous" en vez
  -- de adivinar cuál se quiso decir.
  update proposals set status = 'viewed', viewed_at = now()
    where proposals.id = v_proposal_id and proposals.status = 'published';

  return query
    select p.content, p.pricing_subtotal, p.pricing_fees, p.pricing_total,
           p.currency, p.status, p.terms_accepted, p.accepted_at
    from proposals p
    where p.id = v_proposal_id;
end;
$$;

-- ------------------------------------------------------------------
-- accept_proposal: requiere sesión válida vigente; solo permite aceptar
-- desde 'published'/'viewed' (no desde 'draft' — inalcanzable igual — ni
-- desde 'accepted' de nuevo). No inserta en audit_log directamente: el
-- trigger de 0033 ya cubre el cambio de status, con actor_id null porque
-- quien acepta es el cliente anónimo, no un usuario de `profiles`.
-- ------------------------------------------------------------------
create function accept_proposal(p_token uuid, p_session_token uuid, p_accepted_by_name text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_proposal_id uuid;
  v_status text;
begin
  select p.id, p.status into v_proposal_id, v_status
    from proposal_access_sessions s
    join proposals p on p.id = s.proposal_id
    where s.id = p_session_token
      and p.public_token = p_token
      and s.expires_at > now()
      and (p.expires_at is null or p.expires_at > now());

  if v_proposal_id is null then
    raise exception 'session_invalid';
  end if;

  if v_status not in ('published', 'viewed') then
    raise exception 'cannot_accept_in_current_status';
  end if;

  if p_accepted_by_name is null or length(trim(p_accepted_by_name)) = 0 then
    raise exception 'accepted_by_name_required';
  end if;

  -- El cambio de status a 'accepted' lo audita trg_log_proposal_status_change
  -- (0033_proposals_audit.sql) — no se duplica aquí un insert manual (ese
  -- trigger corre para cualquier cambio de status sin importar el actor,
  -- incluido este caso donde quien actúa es el cliente sin sesión de
  -- Supabase Auth: auth.uid() queda null en esa fila de audit_log, igual
  -- que ya ocurría antes con el insert manual que se quitó de acá).
  update proposals
    set status = 'accepted',
        terms_accepted = true,
        accepted_at = now(),
        accepted_by_name = trim(p_accepted_by_name)
    where id = v_proposal_id;
end;
$$;

revoke execute on function get_proposal_gate(uuid) from public;
revoke execute on function verify_proposal_access(uuid, text) from public;
revoke execute on function get_proposal_content(uuid, uuid) from public;
revoke execute on function accept_proposal(uuid, uuid, text) from public;

-- Se otorga a anon (el sitio público no tiene sesión de Supabase Auth) y
-- también a authenticated, por si una asesora abre el link público estando
-- logueada en el admin en el mismo navegador — estas funciones se validan
-- enteramente por token/sesión/código, nunca confían en el rol del llamante.
grant execute on function get_proposal_gate(uuid) to anon, authenticated;
grant execute on function verify_proposal_access(uuid, text) to anon, authenticated;
grant execute on function get_proposal_content(uuid, uuid) to anon, authenticated;
grant execute on function accept_proposal(uuid, uuid, text) to anon, authenticated;
