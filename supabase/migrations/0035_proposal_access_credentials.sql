-- Módulo: Smart Proposal Builder — separa las credenciales de acceso a una
-- tabla propia (`proposal_access_credentials`), 1:1 con `proposals`.
--
-- Esto documenta un cambio que ya se aplicó directo en el proyecto Supabase
-- real (fuera del historial de migraciones) — mismo patrón de "drift" ya
-- documentado varias veces en este repo (0008, 0011, 0013, 0015, 0016, 0020,
-- 0025): sin este archivo, `supabase db reset` en un entorno nuevo
-- reconstruiría el esquema viejo de 0029 (access_code_hash/access_attempts/
-- access_locked_until como columnas de `proposals`), que ya no es lo que hay
-- en producción, y las funciones de abajo (reescritas para usar la tabla
-- nueva) directamente no compilarían contra ese esquema viejo.
--
-- Motivo del cambio (tal como se confirmó): aislar el secreto (el hash) y su
-- estado de throttling en una tabla aparte de menor superficie, en vez de
-- mezclarlo con las columnas de negocio de `proposals` que se leen/escriben
-- constantemente desde el builder admin.

create table proposal_access_credentials (
  proposal_id          uuid primary key references proposals(id) on delete cascade,
  access_code_hash     text,
  access_attempts      integer not null default 0 check (access_attempts >= 0),
  access_locked_until  timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

alter table proposal_access_credentials enable row level security;
-- Sin policies — mismo patrón que proposal_access_sessions (0030) y
-- lead_submission_attempts (0003): ni anon ni authenticated la tocan
-- directo, solo las funciones security definer de abajo.

-- Migra cualquier dato real que ya existiera en las columnas viejas de
-- `proposals` antes de eliminarlas — defensivo/idempotente, como el resto de
-- las migraciones de "drift" de este proyecto. En una base recién creada
-- (0029 sin filas todavía) esto no mueve nada.
insert into proposal_access_credentials (proposal_id, access_code_hash, access_attempts, access_locked_until)
select id, access_code_hash, access_attempts, access_locked_until
from proposals
where access_code_hash is not null or access_attempts > 0 or access_locked_until is not null
on conflict (proposal_id) do nothing;

alter table proposals
  drop column if exists access_code_hash,
  drop column if exists access_attempts,
  drop column if exists access_locked_until;

create trigger trg_proposal_access_credentials_updated_at
  before update on proposal_access_credentials
  for each row execute function set_updated_at();

-- ------------------------------------------------------------------
-- verify_proposal_access: mismo comportamiento que en 0031, pero (a) lee/
-- escribe proposal_access_credentials en vez de columnas de proposals, y
-- (b) devuelve `result` en vez de `error_code`, con un caso nuevo
-- 'access_not_configured' (access_required = true pero todavía no se llamó
-- nunca a set_proposal_access_code — no es lo mismo que "código incorrecto":
-- no hay nada contra qué comparar, así que tampoco cuenta como intento
-- fallido). El cambio de forma de RETURNS TABLE obliga a DROP + CREATE (no
-- alcanza con CREATE OR REPLACE), así que los grants hay que reponerlos
-- explícitamente al final del archivo.
-- ------------------------------------------------------------------
drop function if exists verify_proposal_access(uuid, text);

create function verify_proposal_access(p_token uuid, p_access_code text default null)
returns table (result text, session_token uuid, session_expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_proposal_id uuid;
  v_access_required boolean;
  v_credentials proposal_access_credentials%rowtype;
begin
  select p.id, p.access_required into v_proposal_id, v_access_required
    from proposals p
    where p.public_token = p_token
      and p.status in ('published', 'viewed', 'accepted')
      and (p.expires_at is null or p.expires_at > now());

  if v_proposal_id is null then
    return query select 'not_found'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if not v_access_required then
    return query
      with new_session as (
        insert into proposal_access_sessions (proposal_id)
        values (v_proposal_id)
        returning id, expires_at
      )
      select 'ok'::text, new_session.id, new_session.expires_at from new_session;
    return;
  end if;

  select * into v_credentials from proposal_access_credentials where proposal_id = v_proposal_id;

  if not found or v_credentials.access_code_hash is null then
    return query select 'access_not_configured'::text, null::uuid, null::timestamptz;
    return;
  end if;

  if v_credentials.access_locked_until is not null then
    if v_credentials.access_locked_until > now() then
      return query select 'locked'::text, null::uuid, null::timestamptz;
      return;
    else
      -- El bloqueo ya venció por tiempo, pero access_attempts nunca baja
      -- solo — sin este reset, el primer intento fallido después del
      -- bloqueo volvería a disparar el lock instantáneo.
      update proposal_access_credentials set access_attempts = 0, access_locked_until = null
        where proposal_id = v_proposal_id;
    end if;
  end if;

  if p_access_code is null
     or extensions.crypt(p_access_code, v_credentials.access_code_hash) <> v_credentials.access_code_hash then
    update proposal_access_credentials
      set access_attempts = access_attempts + 1,
          access_locked_until = case
            when access_attempts + 1 >= 5 then now() + interval '15 minutes'
            else access_locked_until
          end
      where proposal_id = v_proposal_id;
    return query select 'invalid_code'::text, null::uuid, null::timestamptz;
    return;
  end if;

  update proposal_access_credentials set access_attempts = 0, access_locked_until = null
    where proposal_id = v_proposal_id;

  return query
    with new_session as (
      insert into proposal_access_sessions (proposal_id)
      values (v_proposal_id)
      returning id, expires_at
    )
    select 'ok'::text, new_session.id, new_session.expires_at from new_session;
end;
$$;

revoke execute on function verify_proposal_access(uuid, text) from public;
grant execute on function verify_proposal_access(uuid, text) to anon, authenticated;

-- ------------------------------------------------------------------
-- set_proposal_access_code: misma firma/tipo de retorno que en 0032 (void),
-- así que CREATE OR REPLACE alcanza y conserva los grants existentes. Ahora
-- hace upsert sobre proposal_access_credentials en vez de UPDATE sobre
-- proposals.
-- ------------------------------------------------------------------
create or replace function set_proposal_access_code(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  if p_code is null or length(trim(p_code)) < 6 then
    raise exception 'El código de acceso debe tener al menos 6 caracteres';
  end if;

  if not exists (select 1 from proposals where id = p_id) then
    raise exception 'Propuesta no encontrada';
  end if;

  insert into proposal_access_credentials (proposal_id, access_code_hash, access_attempts, access_locked_until)
  values (p_id, extensions.crypt(p_code, extensions.gen_salt('bf')), 0, null)
  on conflict (proposal_id) do update
    set access_code_hash = excluded.access_code_hash,
        access_attempts = 0,
        access_locked_until = null;

  delete from proposal_access_sessions where proposal_id = p_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_access_code_changed', 'proposal', p_id::text,
    'Cambió el código de acceso de la propuesta');
end;
$$;

-- ------------------------------------------------------------------
-- publish_proposal: la validación de "tiene código de acceso configurado"
-- ahora consulta proposal_access_credentials en vez de
-- v_proposal.access_code_hash (esa columna ya no existe). Resto sin cambios.
-- ------------------------------------------------------------------
create or replace function publish_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_proposal proposals%rowtype;
  v_missing text[] := '{}';
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  select * into v_proposal from proposals where id = p_id;
  if not found then
    raise exception 'Propuesta no encontrada';
  end if;

  if coalesce(v_proposal.title, '') = '' then
    v_missing := array_append(v_missing, 'título de portada');
  end if;
  if coalesce(jsonb_array_length(v_proposal.content->'days'), 0) = 0 then
    v_missing := array_append(v_missing, 'al menos un día de itinerario');
  end if;
  if coalesce(jsonb_array_length(v_proposal.content->'pricing'->'lines'), 0) = 0 then
    v_missing := array_append(v_missing, 'al menos una línea de precio');
  end if;
  if v_proposal.access_required and not exists (
    select 1 from proposal_access_credentials c
    where c.proposal_id = p_id and c.access_code_hash is not null
  ) then
    v_missing := array_append(v_missing, 'código de acceso');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Faltan datos para publicar: %', array_to_string(v_missing, ', ');
  end if;

  update proposals set status = 'published', published_at = now() where id = p_id;
end;
$$;
