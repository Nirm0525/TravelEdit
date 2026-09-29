-- Módulo: Smart Proposal Builder — funciones administrativas (staff).
-- Requieren can_manage_proposals(); se llaman siempre autenticado desde el
-- admin, nunca desde el sitio público.

-- ------------------------------------------------------------------
-- publish_proposal: valida que la propuesta esté "lista" antes de
-- publicarla — esta validación es la razón por la que NO existe un estado
-- persistido "ready" (ver arquitectura aprobada): es una condición
-- calculada aquí mismo en el momento de publicar, no una columna que haya
-- que mantener sincronizada cada vez que se edita el contenido.
-- ------------------------------------------------------------------
create function publish_proposal(p_id uuid) returns void
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
  if v_proposal.access_required and v_proposal.access_code_hash is null then
    v_missing := array_append(v_missing, 'código de acceso');
  end if;

  if array_length(v_missing, 1) > 0 then
    raise exception 'Faltan datos para publicar: %', array_to_string(v_missing, ', ');
  end if;

  -- El cambio de status lo audita trg_log_proposal_status_change
  -- (0033_proposals_audit.sql) — no se duplica aquí un insert manual.
  update proposals set status = 'published', published_at = now() where id = p_id;
end;
$$;

-- ------------------------------------------------------------------
-- unpublish_proposal: regresa la propuesta a borrador y revoca de inmediato
-- cualquier sesión de acceso ya emitida — un cliente con sesión activa no
-- debe poder seguir leyendo el contenido apenas se despublica, sin esperar
-- a que esa sesión expire sola.
-- ------------------------------------------------------------------
create function unpublish_proposal(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  update proposals
    set status = 'draft', published_at = null
    where id = p_id and status in ('published', 'viewed', 'accepted');

  if not found then
    raise exception 'La propuesta no está publicada';
  end if;

  delete from proposal_access_sessions where proposal_id = p_id;
end;
$$;

-- ------------------------------------------------------------------
-- set_proposal_access_code: único punto de escritura de access_code_hash
-- (ver revoke en 0029_proposals.sql) — el código en texto plano solo existe
-- en el parámetro de esta llamada, nunca se persiste. Un código nuevo
-- invalida cualquier acceso concedido con el código anterior: borra las
-- sesiones activas de esa propuesta en la misma transacción.
-- ------------------------------------------------------------------
create function set_proposal_access_code(p_id uuid, p_code text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  if p_code is null or length(trim(p_code)) < 6 then
    raise exception 'El código de acceso debe tener al menos 6 caracteres';
  end if;

  -- crypt()/gen_salt() calificadas con extensions. — pgcrypto vive en el
  -- schema `extensions` en Supabase, no en `public` (ver comentario en
  -- 0029_proposals.sql), y esta función corre con search_path = public.
  update proposals
    set access_code_hash = extensions.crypt(p_code, extensions.gen_salt('bf')),
        access_attempts = 0,
        access_locked_until = null
    where id = p_id;

  if not found then
    raise exception 'Propuesta no encontrada';
  end if;

  delete from proposal_access_sessions where proposal_id = p_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_access_code_changed', 'proposal', p_id::text,
    'Cambió el código de acceso de la propuesta');
end;
$$;

revoke execute on function publish_proposal(uuid) from public;
revoke execute on function unpublish_proposal(uuid) from public;
revoke execute on function set_proposal_access_code(uuid, text) from public;

grant execute on function publish_proposal(uuid) to authenticated;
grant execute on function unpublish_proposal(uuid) to authenticated;
grant execute on function set_proposal_access_code(uuid, text) to authenticated;
