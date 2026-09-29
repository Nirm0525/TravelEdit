-- Módulo: Smart Proposal Builder — autogeneración segura del código de
-- acceso privado. Reemplaza el flujo donde el asesor escribía el código a
-- mano (set_proposal_access_code sigue existiendo, sin cambios, por si algo
-- más la usa) por uno donde Supabase genera el código con crypto seguro
-- (pgcrypto gen_random_bytes, nunca Math.random/timestamps/IDs/OpenAI),
-- devuelve el texto plano UNA sola vez en la respuesta de la función, y
-- persiste únicamente el hash — igual que ya hacía set_proposal_access_code.

-- ------------------------------------------------------------------
-- generate_proposal_access_code: genera un código con formato "TRV-XXXXX"
-- (alfabeto de 32 símbolos sin 0/1/I/O para evitar ambigüedad visual),
-- reutilizando exactamente el mismo upsert/reset/revocación de sesiones que
-- set_proposal_access_code (0035). Nunca devuelve access_code_hash — solo
-- el código plano, y solo en el valor de retorno de ESTA llamada; no queda
-- persistido en ninguna columna ni tabla.
-- ------------------------------------------------------------------
create function generate_proposal_access_code(p_id uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  -- 8 dígitos (2-9) + 24 letras (A-Z sin I/O) = 32 símbolos exactos =
  -- 256/32 sin sesgo de módulo al mapear un byte aleatorio a un índice.
  v_charset text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  i int;
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  if not exists (select 1 from proposals where id = p_id) then
    raise exception 'Propuesta no encontrada';
  end if;

  v_bytes := extensions.gen_random_bytes(5);
  for i in 0..4 loop
    v_code := v_code || substr(v_charset, (get_byte(v_bytes, i) % length(v_charset)) + 1, 1);
  end loop;
  v_code := 'TRV-' || v_code;

  insert into proposal_access_credentials (proposal_id, access_code_hash, access_attempts, access_locked_until)
  values (p_id, extensions.crypt(v_code, extensions.gen_salt('bf')), 0, null)
  on conflict (proposal_id) do update
    set access_code_hash = excluded.access_code_hash,
        access_attempts = 0,
        access_locked_until = null;

  -- Mismo motivo que en set_proposal_access_code: un código nuevo invalida
  -- cualquier sesión ya concedida con el código anterior.
  delete from proposal_access_sessions where proposal_id = p_id;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_access_code_changed', 'proposal', p_id::text,
    'Generó un nuevo código de acceso para la propuesta');

  return v_code;
end;
$$;

revoke execute on function generate_proposal_access_code(uuid) from public;
grant execute on function generate_proposal_access_code(uuid) to authenticated;

-- ------------------------------------------------------------------
-- proposal_has_access_code: el admin necesita saber, al reabrir una
-- propuesta, si ya hay una credencial configurada — sin esto no puede
-- distinguir "nunca se generó" de "se generó pero ya no se conoce el texto
-- plano" (ver sección E de la spec: nunca se intenta recuperar el código
-- viejo). Devuelve solo un boolean, nunca el hash.
-- ------------------------------------------------------------------
create function proposal_has_access_code(p_id uuid) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  return exists (
    select 1 from proposal_access_credentials
    where proposal_id = p_id and access_code_hash is not null
  );
end;
$$;

revoke execute on function proposal_has_access_code(uuid) from public;
grant execute on function proposal_has_access_code(uuid) to authenticated;
