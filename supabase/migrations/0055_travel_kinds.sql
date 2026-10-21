-- Módulo: Viajes (Fase 2) — Propuestas e Itinerarios en la misma tabla. RECONCILIADA con el PREFLIGHT REAL de producción.
--
-- Cada función se partió de su definición REAL en producción (function.def / audit.functions del preflight) y solo se le añadió lo
-- necesario por `kind`; el resto de su comportamiento (orden de validaciones, mensajes, límites) es el de producción.
--
-- QUÉ HACE
--   1) public.proposals gana `kind` ('proposal' | 'itinerary', NOT NULL, DEFAULT 'proposal') y `shared_at`. Las filas actuales quedan
--      como 'proposal'. `kind` es inmutable tras el INSERT.
--   2) CHECK compuesto kind/status:  proposal → draft, published, viewed, accepted, expired
--                                    itinerary → draft, shared, viewed
--      ('expired' sigue siendo SOLO de propuestas y se calcula al leer, como hoy.)
--   3) CHECK de forma (proposals_kind_shape_check): propuesta → shared_at null. Itinerario → sin published_at, aceptación, precios,
--      elecciones ni comentarios; y coherencia estado/shared_at (draft ⇒ null; shared|viewed ⇒ not null).
--      `shared` (estrategia A): existe en el CHECK pero ninguna vía cliente puede escribirlo (punto 6) y todavía no hay función
--      que lo haga (share_itinerary llega en 0056); además un `shared` sin `shared_at` es imposible por CHECK.
--   4) public.can_travel(kind, acción): compatibility mapping TEMPORAL con profiles.role (admin/editor/staff; NO hay tabla de
--      permisos). SECURITY INVOKER, search_path vacío. Eliminar: solo admin. Publicar/despublicar: admin, editor y staff (la
--      Asesora solo las suyas: ownership por is_own_or_full en las RPC y en las policies).
--   5) RLS de proposals por tipo (ver/crear/editar/eliminar). UPDATE con USING y WITH CHECK. Las policies conservan los roles
--      reales (select/insert/update: public; delete: authenticated). La lectura de documentos adjuntos combina el permiso por
--      tipo con la propiedad de la asesora (antes: can_manage_proposals() + exists, que dependía de la RLS de proposals).
--   6) HARDENING: authenticated tenía INSERT/UPDATE de TABLA (ACL real). Se revocan y se conceden solo las columnas que el panel
--      escribe; así ya no puede saltarse las RPC escribiendo status, published_at, shared_at, viewed_at, accepted_at,
--      accepted_by_name, terms_accepted, service_choices ni service_comments (ni public_token, kind, pricing_*, feedback_sent_at,
--      accepted_notified_at). CONSECUENCIA: toda columna NUEVA de proposals no es escribible por authenticated hasta concederla.
--   7) publish_proposal, unpublish_proposal, accept_proposal, set_proposal_service_choice y set_proposal_service_comment comprueban
--      kind = 'proposal' de forma EXPLÍCITA (kind_not_supported). publish/unpublish además exigen que la Asesora sea la dueña.
--   8) get_proposal_gate, verify_proposal_access y get_proposal_content soportan ambos tipos (proposal: published|viewed|accepted;
--      itinerary: shared|viewed), devuelven `kind`; el contenido de un itinerario se proyecta en el servidor SIN precios, términos,
--      aceptación, elecciones ni comentarios.
--   9) set_proposal_access_code y generate_proposal_access_code: permiso por tipo y auditoría por tipo (mismo código, mismas sesiones).
--  10) recompute_proposal_pricing: un itinerario siempre tiene totales 0; la propuesta conserva el cálculo.
--  11) La importación de PDF es EXCLUSIVA de propuestas (trigger en proposal_imports).
--  12) Auditoría: la propuesta conserva sus textos; el itinerario usa entity_type 'itinerary'. search_path vacío (antes public, pg_temp).
--  13) Se revoca EXECUTE de PUBLIC/anon/authenticated en enforce_proposal_advisor y enforce_credential_ownership (tenían PUBLIC) y en
--      las funciones de trigger nuevas. recompute_proposal_pricing ya lo tenía revocado.
--
-- QUÉ NO HACE: compartir/dejar de compartir un itinerario, «listo para compartir», vista privada del itinerario, correo (0056);
--   get_publish_readiness (NO existe en producción; la reconciliación de 0053 es aparte). proposal_has_access_code no cambia.
--   No se tocan los EXECUTE de log_proposal_* (CREATE OR REPLACE conserva la ACL real de producción: solo postgres y service_role;
--   PUBLIC, anon y authenticated NO pueden ejecutarlas).
-- NO crea índice por kind (volumen bajo; un índice sin uso lo marcaría el Performance Advisor).
--
-- Aplicar con: supabase db query --linked -f supabase/migrations/0055_travel_kinds.sql
-- Verificar (solo lectura): supabase db query --linked -f supabase/migration-scripts/0055_travel_kinds_verify.sql
-- Reversión (se niega si existe algún itinerario; generada desde el preflight real, ver 0055_generate_rollback.ts):
--   supabase db query --linked -f supabase/migration-scripts/0055_travel_kinds_rollback.sql
begin;

do $$
declare
  v_missing text[] := '{}';
  v_table text;
  v_col text;
  v_audit_check text;
begin
  foreach v_table in array array['proposals', 'proposal_access_sessions', 'proposal_access_credentials',
                                  'proposal_imports', 'proposal_service_attachments', 'audit_log'] loop
    if to_regclass('public.' || v_table) is null then
      v_missing := v_missing || ('tabla public.' || v_table);
    end if;
  end loop;
  if to_regprocedure('private.app_user_role()') is null then v_missing := v_missing || 'función private.app_user_role()'; end if;
  if to_regprocedure('public.can_manage_proposals()') is null then v_missing := v_missing || 'función public.can_manage_proposals()'; end if;
  if to_regprocedure('public.is_own_or_full(uuid)') is null then v_missing := v_missing || 'función public.is_own_or_full(uuid)'; end if;
  if to_regclass('public.proposals') is not null then
    foreach v_col in array array['service_choices', 'service_comments', 'accepted_by_name', 'terms_accepted', 'accepted_at',
                                  'published_at', 'viewed_at', 'expires_at', 'advisor_id', 'created_by', 'access_required',
                                  'pricing_subtotal', 'pricing_fees', 'pricing_total', 'origin_channel', 'client_email',
                                  'feedback_sent_at', 'accepted_notified_at'] loop
      if not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'proposals' and column_name = v_col) then
        v_missing := v_missing || ('columna public.proposals.' || v_col);
      end if;
    end loop;
  end if;
  if array_length(v_missing, 1) > 0 then
    raise exception '0055: faltan requisitos en esta base: %', array_to_string(v_missing, '; ');
  end if;

  -- audit_log: si tiene un CHECK sobre entity_type, debe admitir 'itinerary' (ampliarlo antes, a propósito).
  select string_agg(pg_get_constraintdef(c.oid), ' ') into v_audit_check
    from pg_constraint c
   where c.conrelid = 'public.audit_log'::regclass and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%entity_type%';
  if v_audit_check is not null and v_audit_check not like '%itinerary%' then
    raise exception '0055: audit_log restringe entity_type y no admite ''itinerary'': %', v_audit_check;
  end if;
end $$;

-- ------------------------------------------------------------------
-- 1) Columnas. ADD COLUMN con DEFAULT constante no reescribe la tabla (metadato): las filas existentes quedan 'proposal'.
-- ------------------------------------------------------------------
alter table public.proposals
  add column kind text not null default 'proposal',
  add column shared_at timestamptz;

alter table public.proposals
  add constraint proposals_kind_check check (kind in ('proposal', 'itinerary'));

comment on column public.proposals.kind is
  'Tipo de viaje: proposal (etapa comercial/contractual) o itinerary (viaje confirmado/operativo). Inmutable tras el INSERT.';
comment on column public.proposals.shared_at is
  'Solo itinerarios: cuándo se compartió con el cliente. En propuestas es siempre null (su equivalente es published_at).';

-- ------------------------------------------------------------------
-- 2) Estados: el CHECK de status (en producción: proposals_status_check; se busca por catálogo) se reemplaza por uno compuesto.
-- ------------------------------------------------------------------
do $$
declare
  v_name text;
  v_dropped int := 0;
begin
  for v_name in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.proposals'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%''published''%'
       and pg_get_constraintdef(c.oid) like '%''accepted''%'
  loop
    execute format('alter table public.proposals drop constraint %I', v_name);
    v_dropped := v_dropped + 1;
  end loop;
  if v_dropped <> 1 then
    raise exception 'Se esperaba exactamente 1 CHECK de status en proposals y se encontraron %', v_dropped;
  end if;
end $$;

alter table public.proposals
  add constraint proposals_kind_status_check check (
    (kind = 'proposal'  and status in ('draft', 'published', 'viewed', 'accepted', 'expired'))
    or
    (kind = 'itinerary' and status in ('draft', 'shared', 'viewed'))
  );

-- ------------------------------------------------------------------
-- 3) Forma por tipo. Para las filas actuales (todas 'proposal') la única condición es shared_at is null (columna nueva).
--    pricing_* los fija el trigger BEFORE (punto 10) antes de evaluar el CHECK.
-- ------------------------------------------------------------------
alter table public.proposals
  add constraint proposals_kind_shape_check check (
    case kind
      when 'proposal' then shared_at is null
      else published_at is null
           and accepted_at is null
           and accepted_by_name is null
           and terms_accepted = false
           and pricing_subtotal = 0 and pricing_fees = 0 and pricing_total = 0
           and service_choices = '{}'::jsonb
           and service_comments = '{}'::jsonb
           and (   (status = 'draft' and shared_at is null)
                or (status in ('shared', 'viewed') and shared_at is not null))
    end
  );

create or replace function public.enforce_proposal_kind_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'kind_immutable: el tipo (kind) de un viaje no se puede cambiar';
  end if;
  return new;
end;
$$;

create trigger trg_proposals_kind_immutable
  before update of kind on public.proposals
  for each row execute function public.enforce_proposal_kind_immutable();

-- ------------------------------------------------------------------
-- 4) Permisos por tipo — COMPATIBILITY MAPPING TEMPORAL (no existe tabla de permisos; solo profiles.role).
--      ver / crear / editar / gestionar_documentos → admin, editor, staff   (= can_manage_proposals() de hoy)
--      eliminar                                    → solo admin             (= policy proposals_delete de hoy)
--      publicar, despublicar, gestionar_precios, gestionar_terminos (solo proposal) → admin, editor, staff
--    La Asesora (staff) solo actúa sobre lo suyo: se aplica con is_own_or_full(advisor_id) en las policies y en publish/unpublish.
--    'compartir' (itinerarios) se define en 0056 (admin, editor y staff; la asesora solo los propios).
-- ------------------------------------------------------------------
create or replace function public.can_travel(p_kind text, p_action text) returns boolean
language sql stable set search_path = '' as $$
  select case
    when p_kind not in ('proposal', 'itinerary') then false
    when private.app_user_role() is null then false
    when p_action = 'eliminar' then private.app_user_role() = 'admin'
    when p_action in ('ver', 'crear', 'editar', 'gestionar_documentos')
      then private.app_user_role() in ('admin', 'editor', 'staff')
    when p_kind = 'proposal' and p_action in ('publicar', 'despublicar', 'gestionar_precios', 'gestionar_terminos')
      then private.app_user_role() in ('admin', 'editor', 'staff')
    else false
  end
$$;

revoke execute on function public.can_travel(text, text) from public, anon;
grant execute on function public.can_travel(text, text) to authenticated;

-- ------------------------------------------------------------------
-- 5) RLS por tipo, sobre las policies REALES (roles incluidos).
-- ------------------------------------------------------------------
drop policy if exists proposals_select on public.proposals;
drop policy if exists proposals_insert on public.proposals;
drop policy if exists proposals_update on public.proposals;
drop policy if exists proposals_delete on public.proposals;

create policy proposals_select on public.proposals for select
  using (public.can_travel(kind, 'ver') and public.is_own_or_full(advisor_id));
create policy proposals_insert on public.proposals for insert
  with check (public.can_travel(kind, 'crear') and created_by = auth.uid());
create policy proposals_update on public.proposals for update
  using (public.can_travel(kind, 'editar') and public.is_own_or_full(advisor_id))
  with check (public.can_travel(kind, 'editar') and public.is_own_or_full(advisor_id));
create policy proposals_delete on public.proposals for delete to authenticated
  using (public.can_travel(kind, 'eliminar'));

-- Documentos adjuntos: permiso por tipo Y propiedad de la asesora, de forma explícita. Una asesora NO lee los de otra.
drop policy if exists psa_select on public.proposal_service_attachments;
create policy psa_select on public.proposal_service_attachments for select to authenticated
  using (
    exists (
      select 1 from public.proposals p
      where p.id = proposal_service_attachments.proposal_id
        and public.can_travel(p.kind, 'gestionar_documentos')
        and public.is_own_or_full(p.advisor_id)
    )
  );

-- ------------------------------------------------------------------
-- 6) HARDENING de privilegios de proposals para authenticated (ACL real: SELECT, INSERT, UPDATE y DELETE de TABLA).
--    Auditoría del panel (ProposalsService, DashboardService y las Edge Functions que usan el cliente del usuario):
--      INSERT: client_name, lead_id, origin_channel, destination_text, travelers_count, start_date, end_date, content,
--              created_by (+ kind, que ahora se escribe explícito).
--      UPDATE: client_name, client_email, destination_text, start_date, end_date, travelers_count, advisor_id, currency,
--              access_required, expires_at y content (también lo escribe proposal-service-files con el cliente del usuario).
--    NO escribe nunca status, published_at, shared_at, viewed_at, accepted_at, accepted_by_name, terms_accepted, service_choices ni
--    service_comments (las cambian las RPC security definer o service_role), ni public_token, kind (tras el INSERT), pricing_*,
--    feedback_sent_at ni accepted_notified_at (service_role). Un REVOKE por columna no sirve con un GRANT de tabla completa:
--    se quita el de tabla y se concede por columna. DELETE y SELECT de tabla se conservan (los limita la RLS).
-- ------------------------------------------------------------------
revoke insert, update on table public.proposals from authenticated;

grant insert (client_name, lead_id, origin_channel, destination_text, travelers_count, start_date, end_date, content, created_by, kind)
  on public.proposals to authenticated;
grant update (client_name, client_email, destination_text, start_date, end_date, travelers_count, advisor_id, currency,
              access_required, expires_at, content)
  on public.proposals to authenticated;

-- ------------------------------------------------------------------
-- 7) Trigger de precios (definición real + rama de itinerario) y funciones de trigger nuevas.
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_proposal_pricing()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  -- Un itinerario NO tiene precios: los totales son siempre 0, aunque el content traiga líneas de otra época.
  if new.kind = 'itinerary' then
    new.pricing_subtotal := 0;
    new.pricing_fees := 0;
    new.pricing_total := 0;
    return new;
  end if;

  -- Propuesta: el cálculo de siempre.
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

create or replace function public.enforce_import_targets_proposal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.proposal_id is not null
     and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.kind = 'proposal') then
    raise exception 'import_requires_proposal: la importación de PDF solo aplica a propuestas';
  end if;
  return new;
end;
$$;

create trigger trg_proposal_imports_only_proposals
  before insert or update of proposal_id on public.proposal_imports
  for each row execute function public.enforce_import_targets_proposal();

-- ------------------------------------------------------------------
-- 8) RPC comerciales (definiciones reales + guard explícito kind_not_supported). Los EXECUTE no cambian (CREATE OR REPLACE
--    conserva la ACL): publish/unpublish → authenticated; accept/choice/comment → anon y authenticated.
-- ------------------------------------------------------------------
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


  -- Solo propuestas (guard explícito, no depende de un CHECK).
  if v_proposal.kind <> 'proposal' then
    raise exception 'kind_not_supported: solo se puede publicar una propuesta';
  end if;


  -- La Asesora (staff) solo publica SUS propuestas (admin y editor, cualquiera).
  if not public.is_own_or_full(v_proposal.advisor_id) then
    raise exception 'No autorizado: esta propuesta pertenece a otra asesora';
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
declare
  v_kind text;
  v_advisor uuid;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  select p.kind, p.advisor_id
  into v_kind, v_advisor
  from public.proposals p
  where p.id = p_id;


  if found then
    -- Solo propuestas (guard explícito).
    if v_kind <> 'proposal' then
      raise exception 'kind_not_supported: solo se puede despublicar una propuesta';
    end if;

    -- La Asesora (staff) solo despublica SUS propuestas.
    if not public.is_own_or_full(v_advisor) then
      raise exception 'No autorizado: esta propuesta pertenece a otra asesora';
    end if;
  end if;


  update public.proposals
  set
    status = 'draft',
    published_at = null
  where id = p_id
    and kind = 'proposal'
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
  v_kind text;
begin

  v_name := trim(p_accepted_by_name);

  if v_name is null
     or length(v_name) = 0 then
    raise exception 'accepted_by_name_required';
  end if;

  select
    p.id,
    p.status,
    p.kind
  into
    v_proposal_id,
    v_status,
    v_kind
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

  if v_kind <> 'proposal' then
    raise exception 'kind_not_supported';
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
  v_kind text;
BEGIN
  SELECT p.id, p.kind
  INTO v_proposal_id, v_kind
  FROM public.proposal_access_sessions AS s
  JOIN public.proposals AS p
    ON p.id = s.proposal_id
  WHERE s.id = p_session_token
    AND p.public_token = p_token
    AND s.expires_at > now()
    AND p.status IN ('published', 'shared', 'viewed')
    AND (p.expires_at IS NULL OR p.expires_at > now());

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  IF v_kind <> 'proposal' THEN
    RAISE EXCEPTION 'kind_not_supported';
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
  v_kind text;
  v_comment text := trim(coalesce(p_comment, ''));
BEGIN
  SELECT p.id, p.kind
  INTO v_proposal_id, v_kind
  FROM public.proposal_access_sessions AS s
  JOIN public.proposals AS p
    ON p.id = s.proposal_id
  WHERE s.id = p_session_token
    AND p.public_token = p_token
    AND s.expires_at > now()
    AND p.status IN ('published', 'shared', 'viewed')
    AND (p.expires_at IS NULL OR p.expires_at > now());

  IF v_proposal_id IS NULL THEN
    RAISE EXCEPTION 'session_invalid';
  END IF;

  IF v_kind <> 'proposal' THEN
    RAISE EXCEPTION 'kind_not_supported';
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

-- ------------------------------------------------------------------
-- 9) Código de acceso compartido: permiso por tipo y auditoría por tipo (definiciones reales + kind).
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_proposal_access_code(p_id uuid, p_code text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_code text;
  v_kind text;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  select p.kind
  into v_kind
  from public.proposals p
  where p.id = p_id;


  if not found then
    raise exception 'Propuesta no encontrada';
  end if;


  -- Permiso por tipo (hoy equivale a can_manage_proposals()); la Asesora solo toca lo suyo por enforce_credential_ownership.
  if not public.can_travel(v_kind, 'editar') then
    raise exception 'No autorizado';
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
    case when v_kind = 'itinerary' then 'itinerary_access_code_changed' else 'proposal_access_code_changed' end,
    case when v_kind = 'itinerary' then 'itinerary' else 'proposal' end,
    p_id::text,
    case when v_kind = 'itinerary' then 'Cambió el código de acceso del itinerario' else 'Cambió el código de acceso de la propuesta' end
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
  v_kind text;
  i integer;
begin

  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;


  select p.kind
  into v_kind
  from public.proposals p
  where p.id = p_id;


  if not found then
    raise exception 'Propuesta no encontrada';
  end if;


  -- Permiso por tipo (hoy equivale a can_manage_proposals()); la Asesora solo toca lo suyo por enforce_credential_ownership.
  if not public.can_travel(v_kind, 'editar') then
    raise exception 'No autorizado';
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
    case when v_kind = 'itinerary' then 'itinerary_access_code_changed' else 'proposal_access_code_changed' end,
    case when v_kind = 'itinerary' then 'itinerary' else 'proposal' end,
    p_id::text,
    case when v_kind = 'itinerary' then 'Generó un nuevo código de acceso para el itinerario' else 'Generó un nuevo código de acceso para la propuesta' end
  );


  -- Único momento en que se devuelve el código plano.
  return v_code;

end;
$function$;

-- ------------------------------------------------------------------
-- 10) Acceso privado compartido. El cambio de forma del RETURNS TABLE exige DROP + CREATE en gate y contenido (misma
--     transacción); sus EXECUTE reales eran anon, authenticated y service_role (sin PUBLIC). verify conserva su ACL.
--       proposal → published | viewed | accepted        itinerary → shared | viewed
-- ------------------------------------------------------------------
drop function if exists public.get_proposal_gate(uuid);
CREATE FUNCTION public.get_proposal_gate(p_token uuid)
 RETURNS TABLE(access_required boolean, client_name text, cover_title text, cover_image_path text, status text, kind text)
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
    end,
    p.kind
  from public.proposals p
  where p.public_token = p_token
    and (
      (p.kind = 'proposal' and p.status in ('published', 'viewed', 'accepted'))
      or (p.kind = 'itinerary' and p.status in ('shared', 'viewed'))
    )
$function$;

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
    and (
      (p.kind = 'proposal' and p.status in ('published', 'viewed', 'accepted'))
      or (p.kind = 'itinerary' and p.status in ('shared', 'viewed'))
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

drop function if exists public.get_proposal_content(uuid, uuid);
CREATE FUNCTION public.get_proposal_content(p_token uuid, p_session_token uuid)
 RETURNS TABLE(content jsonb, pricing_subtotal numeric, pricing_fees numeric, pricing_total numeric, currency text, status text, terms_accepted boolean, accepted_at timestamp with time zone, client_name text, destination_text text, start_date date, end_date date, travelers_count integer, service_choices jsonb, service_comments jsonb, kind text)
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
    AND (
      (p.kind = 'proposal' AND p.status IN ('published', 'viewed', 'accepted'))
      OR (p.kind = 'itinerary' AND p.status IN ('shared', 'viewed'))
    )
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
    AND (
      (p.kind = 'proposal' AND p.status = 'published')
      OR (p.kind = 'itinerary' AND p.status = 'shared')
    );

  RETURN QUERY
  -- La proyección por tipo se hace AQUÍ, en el servidor: un itinerario NUNCA devuelve precios, términos, aceptación,
  -- elecciones de servicios ni comentarios de cotización, aunque la pantalla pública se equivoque.
  SELECT
    CASE WHEN p.kind = 'itinerary' THEN (p.content - 'pricing' - 'terms') ELSE p.content END,
    CASE WHEN p.kind = 'itinerary' THEN 0::numeric ELSE p.pricing_subtotal END,
    CASE WHEN p.kind = 'itinerary' THEN 0::numeric ELSE p.pricing_fees END,
    CASE WHEN p.kind = 'itinerary' THEN 0::numeric ELSE p.pricing_total END,
    p.currency,
    p.status,
    CASE WHEN p.kind = 'itinerary' THEN false ELSE p.terms_accepted END,
    CASE WHEN p.kind = 'itinerary' THEN NULL::timestamptz ELSE p.accepted_at END,
    p.client_name,
    p.destination_text,
    p.start_date,
    p.end_date,
    p.travelers_count,
    CASE WHEN p.kind = 'itinerary' THEN '{}'::jsonb ELSE COALESCE(p.service_choices, '{}'::jsonb) END,
    CASE WHEN p.kind = 'itinerary' THEN '{}'::jsonb ELSE COALESCE(p.service_comments, '{}'::jsonb) END,
    p.kind
  FROM public.proposals AS p
  WHERE p.id = v_proposal_id;
END;
$function$;

revoke execute on function public.get_proposal_gate(uuid) from public;
revoke execute on function public.get_proposal_content(uuid, uuid) from public;
grant execute on function public.get_proposal_gate(uuid) to anon, authenticated, service_role;
grant execute on function public.get_proposal_content(uuid, uuid) to anon, authenticated, service_role;

-- ------------------------------------------------------------------
-- 11) Auditoría (definiciones reales; propuesta con sus textos de siempre; itinerario con entity_type 'itinerary').
-- ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.log_proposal_created()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin

  if new.kind = 'itinerary' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (auth.uid(), 'itinerary_created', 'itinerary', new.id::text,
      'Creó el itinerario para "' || new.client_name || '"');
    return new;
  end if;

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
 SET search_path TO ''
AS $function$
declare
  v_summary text;
begin

  -- Itinerario: textos propios. 0055 no genera la transición a 'shared' (llega con share_itinerary en 0056).
  if new.kind = 'itinerary' then
    v_summary := case new.status
      when 'shared' then 'Compartió el itinerario para "' || new.client_name || '"'
      when 'viewed' then 'El cliente visualizó el itinerario para "' || new.client_name || '"'
      when 'draft' then 'Dejó de compartir el itinerario para "' || new.client_name || '"'
      else 'Actualizó el estado del itinerario para "' || new.client_name || '"'
    end;

    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (auth.uid(), 'itinerary_status_changed', 'itinerary', new.id::text, v_summary);
    return new;
  end if;

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
 SET search_path TO ''
AS $function$
begin

  if old.kind = 'itinerary' then
    insert into public.audit_log (actor_id, action, entity_type, entity_id, summary)
    values (auth.uid(), 'itinerary_deleted', 'itinerary', old.id::text,
      'Eliminó el itinerario de "' || old.client_name || '"');
    return old;
  end if;

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

-- ------------------------------------------------------------------
-- 12) Funciones de trigger: nadie debe poder invocarlas. Postgres comprueba EXECUTE al CREAR el trigger, no al dispararlo.
-- ------------------------------------------------------------------
revoke execute on function public.enforce_proposal_kind_immutable() from public, anon, authenticated;
revoke execute on function public.enforce_import_targets_proposal() from public, anon, authenticated;
revoke execute on function public.recompute_proposal_pricing() from public, anon, authenticated;
revoke execute on function public.enforce_proposal_advisor() from public, anon, authenticated;
revoke execute on function public.enforce_credential_ownership() from public, anon, authenticated;

commit;
