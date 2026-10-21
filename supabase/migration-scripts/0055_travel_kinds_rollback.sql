-- Reversión de 0055 (Viajes: kind / itinerarios). GENERADA por 0055_generate_rollback.ts desde el preflight REAL de producción.
-- DESTRUCTIVA: borra las columnas kind y shared_at. Se NIEGA a ejecutarse si existe al menos un itinerario (kind = 'itinerary').
-- Restaura las funciones, policies, CHECK de status y privilegios a lo observado en producción ANTES de 0055.
-- Ejecutar a mano (NO es una migración; por eso vive fuera de supabase/migrations):
--   supabase db query --linked -f supabase/migration-scripts/0055_travel_kinds_rollback.sql
begin;

do $$
begin
  if exists (select 1 from public.proposals where kind = 'itinerary') then
    raise exception 'Hay itinerarios (kind = itinerary): no se revierte 0055. Elimínalos o expórtalos antes.';
  end if;
end $$;

-- Triggers y funciones que añadió 0055.
drop trigger if exists trg_proposal_imports_only_proposals on public.proposal_imports;
drop function if exists public.enforce_import_targets_proposal();
drop trigger if exists trg_proposals_kind_immutable on public.proposals;
drop function if exists public.enforce_proposal_kind_immutable();

-- Policies (dependen de kind y de can_travel): se borran las de 0055 y se recrean las reales de producción.
drop policy if exists proposals_select on public.proposals;
drop policy if exists proposals_insert on public.proposals;
drop policy if exists proposals_update on public.proposals;
drop policy if exists proposals_delete on public.proposals;
drop policy if exists psa_select on public.proposal_service_attachments;
create policy "psa_select" on public."proposal_service_attachments" as permissive for select to "authenticated"
  using ((can_manage_proposals() AND (EXISTS ( SELECT 1
   FROM proposals p
  WHERE (p.id = proposal_service_attachments.proposal_id)))));
create policy "proposals_delete" on public."proposals" as permissive for delete to "authenticated"
  using ((private.app_user_role() = 'admin'::text));
create policy "proposals_insert" on public."proposals" as permissive for insert
  with check ((can_manage_proposals() AND (created_by = auth.uid())));
create policy "proposals_select" on public."proposals" as permissive for select
  using ((can_manage_proposals() AND is_own_or_full(advisor_id)));
create policy "proposals_update" on public."proposals" as permissive for update
  using ((can_manage_proposals() AND is_own_or_full(advisor_id)));

drop function if exists public.can_travel(text, text);

-- Funciones: definiciones REALES previas.
CREATE OR REPLACE FUNCTION public.publish_proposal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal public.proposals%rowtype;
  v_missing text[] := '{}';
  v_has_access_code boolean := false;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  select p.*
  into v_proposal
  from public.proposals p
  where p.id = p_id;


  if not found then
    raise exception 'Propuesta no encontrada';
  end if;


  if v_proposal.status <> 'draft' then
    raise exception
      'Solo se puede publicar una propuesta en estado draft';
  end if;


  if coalesce(
       trim(v_proposal.title),
       ''
     ) = '' then

    v_missing := array_append(
      v_missing,
      'título de portada'
    );

  end if;


  if jsonb_typeof(
       v_proposal.content -> 'days'
     ) <> 'array'
     or jsonb_array_length(
       coalesce(
         v_proposal.content -> 'days',
         '[]'::jsonb
       )
     ) = 0 then

    v_missing := array_append(
      v_missing,
      'al menos un día de itinerario'
    );

  end if;


  if jsonb_typeof(
       v_proposal.content
         -> 'pricing'
         -> 'lines'
     ) <> 'array'
     or jsonb_array_length(
       coalesce(
         v_proposal.content
           -> 'pricing'
           -> 'lines',
         '[]'::jsonb
       )
     ) = 0 then

    v_missing := array_append(
      v_missing,
      'al menos una línea de precio'
    );

  end if;


  if v_proposal.access_required then

    select exists (
      select 1
      from public.proposal_access_credentials c
      where c.proposal_id = p_id
        and c.access_code_hash is not null
        and length(c.access_code_hash) > 0
    )
    into v_has_access_code;


    if not v_has_access_code then

      v_missing := array_append(
        v_missing,
        'código de acceso'
      );

    end if;

  end if;


  if cardinality(v_missing) > 0 then

    raise exception
      'Faltan datos para publicar: %',
      array_to_string(v_missing, ', ');

  end if;


  update public.proposals
  set
    status = 'published',
    published_at = now()
  where id = p_id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.unpublish_proposal(p_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  update public.proposals
  set
    status = 'draft',
    published_at = null
  where id = p_id
    and status in (
      'published',
      'viewed'
    );


  if not found then
    raise exception
      'La propuesta no está publicada o ya fue aceptada';
  end if;


  -- Revocar inmediatamente cualquier sesión emitida.
  delete from public.proposal_access_sessions
  where proposal_id = p_id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.accept_proposal(p_token uuid, p_session_token uuid, p_accepted_by_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_proposal_id uuid;
  v_status text;
  v_name text;
begin

  v_name := trim(p_accepted_by_name);

  if v_name is null
     or length(v_name) = 0 then
    raise exception 'accepted_by_name_required';
  end if;

  select
    p.id,
    p.status
  into
    v_proposal_id,
    v_status
  from public.proposal_access_sessions s
  join public.proposals p
    on p.id = s.proposal_id
  where s.id = p_session_token
    and p.public_token = p_token
    and s.expires_at > now()
    and (
      p.expires_at is null
      or p.expires_at > now()
    )
  limit 1;

  if v_proposal_id is null then
    raise exception 'session_invalid';
  end if;

  if v_status not in (
    'published',
    'viewed'
  ) then
    raise exception 'cannot_accept_in_current_status';
  end if;

  update public.proposals p
  set
    status = 'accepted',
    terms_accepted = true,
    accepted_at = now(),
    accepted_by_name = v_name
  where p.id = v_proposal_id;

end;
$function$;
CREATE OR REPLACE FUNCTION public.set_proposal_service_choice(p_token uuid, p_session_token uuid, p_service_id text, p_accepted boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_proposal_id uuid;
BEGIN
  SELECT p.id
  INTO v_proposal_id
  FROM public.proposal_access_sessions AS s
  JOIN public.proposals AS p
    ON p.id = s.proposal_id
  WHERE s.id = p_session_token
    AND p.public_token = p_token
    AND s.expires_at > now()
    AND p.status IN ('published', 'viewed')
    AND (p.expires_at IS NULL OR p.expires_at > now());

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  -- Verificar que el servicio pertenezca al contenido de la propuesta.
  IF p_service_id IS NULL OR NOT EXISTS (
    SELECT 1
    FROM public.proposals AS p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(p.content->'days') = 'array'
          THEN p.content->'days'
        ELSE '[]'::jsonb
      END
    ) AS d(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(d.value->'services') = 'array'
          THEN d.value->'services'
        ELSE '[]'::jsonb
      END
    ) AS sv(value)
    WHERE p.id = v_proposal_id
      AND sv.value->>'id' = p_service_id
  ) THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  UPDATE public.proposals AS p
  SET service_choices = jsonb_set(
    COALESCE(p.service_choices, '{}'::jsonb),
    ARRAY[p_service_id],
    to_jsonb(p_accepted),
    true
  )
  WHERE p.id = v_proposal_id;
END;
$function$;
CREATE OR REPLACE FUNCTION public.set_proposal_service_comment(p_token uuid, p_session_token uuid, p_service_id text, p_comment text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_proposal_id uuid;
  v_comment text := trim(coalesce(p_comment, ''));
BEGIN
  SELECT p.id
  INTO v_proposal_id
  FROM public.proposal_access_sessions AS s
  JOIN public.proposals AS p
    ON p.id = s.proposal_id
  WHERE s.id = p_session_token
    AND p.public_token = p_token
    AND s.expires_at > now()
    AND p.status IN ('published', 'viewed')
    AND (p.expires_at IS NULL OR p.expires_at > now());

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  IF p_service_id IS NULL OR length(v_comment) > 1000 THEN
    IF p_service_id IS NULL THEN
      RAISE EXCEPTION 'service_not_found';
    ELSE
      RAISE EXCEPTION 'comment_too_long';
    END IF;
  END IF;

  -- Validar que el servicio exista en el itinerario.
  IF NOT EXISTS (
    SELECT 1
    FROM public.proposals AS p
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(p.content->'days') = 'array'
          THEN p.content->'days'
        ELSE '[]'::jsonb
      END
    ) AS d(value)
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(d.value->'services') = 'array'
          THEN d.value->'services'
        ELSE '[]'::jsonb
      END
    ) AS sv(value)
    WHERE p.id = v_proposal_id
      AND sv.value->>'id' = p_service_id
  ) THEN
    RAISE EXCEPTION 'service_not_found';
  END IF;

  -- Un comentario vacío elimina el comentario existente.
  IF v_comment = '' THEN
    UPDATE public.proposals AS p
    SET service_comments =
      COALESCE(p.service_comments, '{}'::jsonb) - p_service_id
    WHERE p.id = v_proposal_id;
  ELSE
    UPDATE public.proposals AS p
    SET service_comments = jsonb_set(
      COALESCE(p.service_comments, '{}'::jsonb),
      ARRAY[p_service_id],
      to_jsonb(v_comment),
      true
    )
    WHERE p.id = v_proposal_id;
  END IF;
END;
$function$;
drop function if exists public.get_proposal_gate(p_token uuid);
CREATE OR REPLACE FUNCTION public.get_proposal_gate(p_token uuid)
 RETURNS TABLE(access_required boolean, client_name text, cover_title text, cover_image_path text, status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.get_proposal_gate(p_token uuid) from public, anon, authenticated;
grant execute on function public.get_proposal_gate(p_token uuid) to "anon", "authenticated", "service_role";
CREATE OR REPLACE FUNCTION public.verify_proposal_access(p_token uuid, p_access_code text DEFAULT NULL::text)
 RETURNS TABLE(result text, session_token uuid, session_expires_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
drop function if exists public.get_proposal_content(p_token uuid, p_session_token uuid);
CREATE OR REPLACE FUNCTION public.get_proposal_content(p_token uuid, p_session_token uuid)
 RETURNS TABLE(content jsonb, pricing_subtotal numeric, pricing_fees numeric, pricing_total numeric, currency text, status text, terms_accepted boolean, accepted_at timestamp with time zone, client_name text, destination_text text, start_date date, end_date date, travelers_count integer, service_choices jsonb, service_comments jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_proposal_id uuid;
BEGIN
  SELECT p.id
  INTO v_proposal_id
  FROM public.proposal_access_sessions AS s
  JOIN public.proposals AS p
    ON p.id = s.proposal_id
  WHERE s.id = p_session_token
    AND p.public_token = p_token
    AND s.expires_at > now()
    AND p.status IN ('published', 'viewed', 'accepted')
    AND (p.expires_at IS NULL OR p.expires_at > now());

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  UPDATE public.proposal_access_sessions
  SET last_seen_at = now()
  WHERE id = p_session_token;

  UPDATE public.proposals AS p
  SET status = 'viewed',
      viewed_at = now()
  WHERE p.id = v_proposal_id
    AND p.status = 'published';

  RETURN QUERY
  SELECT
    p.content,
    p.pricing_subtotal,
    p.pricing_fees,
    p.pricing_total,
    p.currency,
    p.status,
    p.terms_accepted,
    p.accepted_at,
    p.client_name,
    p.destination_text,
    p.start_date,
    p.end_date,
    p.travelers_count,
    COALESCE(p.service_choices, '{}'::jsonb),
    COALESCE(p.service_comments, '{}'::jsonb)
  FROM public.proposals AS p
  WHERE p.id = v_proposal_id;
END;
$function$;
revoke all on function public.get_proposal_content(p_token uuid, p_session_token uuid) from public, anon, authenticated;
grant execute on function public.get_proposal_content(p_token uuid, p_session_token uuid) to "anon", "authenticated", "service_role";
CREATE OR REPLACE FUNCTION public.recompute_proposal_pricing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  new.pricing_subtotal := coalesce((
    select sum(
      (line->>'quantity')::numeric *
      (line->>'unitPrice')::numeric
    )
    from jsonb_array_elements(
      coalesce(
        new.content->'pricing'->'lines',
        '[]'::jsonb
      )
    ) as line
  ), 0);

  new.pricing_fees := coalesce((
    select sum(
      (line->>'quantity')::numeric *
      (line->>'unitPrice')::numeric
    )
    from jsonb_array_elements(
      coalesce(
        new.content->'pricing'->'feesLines',
        '[]'::jsonb
      )
    ) as line
  ), 0);

  new.pricing_total :=
    new.pricing_subtotal + new.pricing_fees;

  return new;
end;
$function$;
CREATE OR REPLACE FUNCTION public.log_proposal_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin

  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_created',
    'proposal',
    new.id::text,
    'Creó la propuesta para "' || new.client_name || '"'
  );

  return new;

end;
$function$;
CREATE OR REPLACE FUNCTION public.log_proposal_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_summary text;
begin

  v_summary :=
    case new.status

      when 'published' then
        'Publicó la propuesta para "' ||
        new.client_name || '"'

      when 'viewed' then
        'El cliente visualizó la propuesta para "' ||
        new.client_name || '"'

      when 'accepted' then
        case
          when nullif(trim(new.accepted_by_name), '') is not null
            then
              'El cliente "' ||
              trim(new.accepted_by_name) ||
              '" aceptó la propuesta para "' ||
              new.client_name || '"'
          else
            'El cliente aceptó la propuesta para "' ||
            new.client_name || '"'
        end

      when 'expired' then
        'La propuesta para "' ||
        new.client_name ||
        '" expiró'

      when 'draft' then
        'Despublicó la propuesta para "' ||
        new.client_name || '"'

      else
        'Actualizó el estado de la propuesta para "' ||
        new.client_name || '"'

    end;


  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_status_changed',
    'proposal',
    new.id::text,
    v_summary
  );


  return new;

end;
$function$;
CREATE OR REPLACE FUNCTION public.log_proposal_deleted()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin

  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_deleted',
    'proposal',
    old.id::text,
    'Eliminó la propuesta de "' ||
    old.client_name || '"'
  );

  return old;

end;
$function$;
CREATE OR REPLACE FUNCTION public.set_proposal_access_code(p_id uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  if not exists (
    select 1
    from public.proposals p
    where p.id = p_id
  ) then
    raise exception 'Propuesta no encontrada';
  end if;


  v_code := trim(p_code);


  if v_code is null
     or length(v_code) < 6 then
    raise exception
      'El código de acceso debe tener al menos 6 caracteres';
  end if;


  if length(v_code) > 64 then
    raise exception
      'El código de acceso no puede superar 64 caracteres';
  end if;


  insert into public.proposal_access_credentials (
    proposal_id,
    access_code_hash,
    access_attempts,
    access_locked_until
  )
  values (
    p_id,
    extensions.crypt(
      v_code,
      extensions.gen_salt('bf')
    ),
    0,
    null
  )
  on conflict (proposal_id)
  do update
  set
    access_code_hash =
      excluded.access_code_hash,
    access_attempts = 0,
    access_locked_until = null;


  delete from public.proposal_access_sessions
  where proposal_id = p_id;


  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_access_code_changed',
    'proposal',
    p_id::text,
    'Cambió el código de acceso de la propuesta'
  );

end;
$function$;
CREATE OR REPLACE FUNCTION public.generate_proposal_access_code(p_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  -- 8 dígitos (2-9) + 24 letras (A-Z sin I/O)
  -- = 32 símbolos exactos.
  -- 256 / 32 evita sesgo al mapear cada byte.
  v_charset text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code text := '';
  v_bytes bytea;
  i integer;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  if not exists (
    select 1
    from public.proposals
    where id = p_id
  ) then
    raise exception 'Propuesta no encontrada';
  end if;


  -- Generar 5 bytes criptográficamente seguros.
  v_bytes := extensions.gen_random_bytes(5);


  for i in 0..4 loop
    v_code :=
      v_code ||
      substr(
        v_charset,
        (get_byte(v_bytes, i) % length(v_charset)) + 1,
        1
      );
  end loop;


  v_code := 'TRV-' || v_code;


  -- Persistir exclusivamente el hash.
  insert into public.proposal_access_credentials (
    proposal_id,
    access_code_hash,
    access_attempts,
    access_locked_until
  )
  values (
    p_id,
    extensions.crypt(
      v_code,
      extensions.gen_salt('bf')
    ),
    0,
    null
  )
  on conflict (proposal_id)
  do update
  set
    access_code_hash = excluded.access_code_hash,
    access_attempts = 0,
    access_locked_until = null;


  -- Un código nuevo invalida cualquier sesión concedida
  -- con la credencial anterior.
  delete from public.proposal_access_sessions
  where proposal_id = p_id;


  insert into public.audit_log (
    actor_id,
    action,
    entity_type,
    entity_id,
    summary
  )
  values (
    auth.uid(),
    'proposal_access_code_changed',
    'proposal',
    p_id::text,
    'Generó un nuevo código de acceso para la propuesta'
  );


  -- Único momento en que se devuelve el código plano.
  return v_code;

end;
$function$;
revoke all on function public.enforce_proposal_advisor() from public, anon, authenticated;
grant execute on function public.enforce_proposal_advisor() to public, "service_role";
revoke all on function public.enforce_credential_ownership() from public, anon, authenticated;
grant execute on function public.enforce_credential_ownership() to public, "service_role";
revoke all on function public.recompute_proposal_pricing() from public, anon, authenticated;
grant execute on function public.recompute_proposal_pricing() to "service_role";
revoke all on function public.log_proposal_created() from public, anon, authenticated;
grant execute on function public.log_proposal_created() to "service_role";
revoke all on function public.log_proposal_status_change() from public, anon, authenticated;
grant execute on function public.log_proposal_status_change() to "service_role";
revoke all on function public.log_proposal_deleted() from public, anon, authenticated;
grant execute on function public.log_proposal_deleted() to "service_role";

-- Constraints y columnas (el CHECK de status vuelve a su definición real).
alter table public.proposals drop constraint if exists proposals_kind_shape_check;
alter table public.proposals drop constraint if exists proposals_kind_status_check;
alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint "proposals_status_check" CHECK ((status = ANY (ARRAY['draft'::text, 'published'::text, 'viewed'::text, 'accepted'::text, 'expired'::text])));
alter table public.proposals drop column if exists shared_at;
alter table public.proposals drop column if exists kind;

-- Privilegios de la tabla y de sus columnas (ACL real previa).
revoke all on table public.proposals from anon, authenticated;
grant DELETE, INSERT, SELECT, UPDATE on table public.proposals to authenticated;

commit;

