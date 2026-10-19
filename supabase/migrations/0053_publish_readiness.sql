-- Módulo: Smart Proposal Builder — una sola fuente de reglas para publicar.
--
-- Antes: publish_proposal() juntaba los faltantes en una frase genérica ("Faltan datos para publicar:
-- título de portada, código de acceso") y el constructor no sabía nada hasta intentar publicar.
-- Ahora get_publish_readiness(proposal_id) devuelve, en SOLO LECTURA, la lista de problemas con detalle
-- (código, mensaje en español, pestaña del constructor y, si aplica, día / servicio / línea), y
-- publish_proposal() usa esa MISMA función: lo que muestra el constructor y lo que exige la
-- publicación no pueden contradecirse.
--
-- NO se inventa ninguna regla. Son exactamente las cuatro que ya aplicaba publish_proposal():
--   1) título de portada (proposals.title, que sale de content.cover.title) no vacío   → pestaña 'cover'
--   2) content.days es un arreglo con al menos un día                                  → pestaña 'journey'
--   3) content.pricing.lines es un arreglo con al menos una línea                      → pestaña 'pricing'
--   4) si access_required: existe un código de acceso configurado (hash no vacío)      → pestaña 'client-trip'
-- Los valores de `tab` son las claves de las pestañas del constructor (client-trip, cover, journey,
-- pricing). day_id / service_id / line_id existen para reglas por elemento; con las reglas actuales
-- (todas globales) vienen en null.
--
-- publish_proposal() conserva sus comprobaciones previas (permiso, que exista, que esté en borrador)
-- y el prefijo del error ("Faltan datos para publicar: …"); ahora el texto lleva el detalle.
-- Quién puede llamar: solo usuarios con sesión (authenticated); la función aplica el mismo criterio de
-- visibilidad que proposals_select (can_manage_proposals + propuesta propia para la Asesora).
begin;

create or replace function public.get_publish_readiness(p_id uuid)
returns table (
  "position"  int,
  code        text,
  message     text,
  tab         text,
  day_id      text,
  service_id  text,
  line_id     text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.proposals%rowtype;
  v_has_code boolean := false;
begin
  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  -- Mismo criterio de visibilidad que proposals_select (la Asesora solo ve las suyas).
  select p.* into v_p
    from public.proposals p
   where p.id = p_id
     and public.is_own_or_full(p.advisor_id);

  if not found then
    raise exception 'Propuesta no encontrada';
  end if;

  -- 1) Título de portada.
  if coalesce(trim(v_p.title), '') = '' then
    return query select 1, 'cover_title_missing'::text, 'Portada: falta el título.'::text,
                        'cover'::text, null::text, null::text, null::text;
  end if;

  -- 2) Al menos un día de itinerario.
  if jsonb_typeof(v_p.content -> 'days') <> 'array'
     or jsonb_array_length(coalesce(v_p.content -> 'days', '[]'::jsonb)) = 0 then
    return query select 2, 'days_missing'::text, 'Itinerario: no hay ningún día. Agrega al menos uno.'::text,
                        'journey'::text, null::text, null::text, null::text;
  end if;

  -- 3) Al menos una línea de precio.
  if jsonb_typeof(v_p.content -> 'pricing' -> 'lines') <> 'array'
     or jsonb_array_length(coalesce(v_p.content -> 'pricing' -> 'lines', '[]'::jsonb)) = 0 then
    return query select 3, 'price_lines_missing'::text, 'Precios: no hay ninguna línea de precio. Agrega al menos una.'::text,
                        'pricing'::text, null::text, null::text, null::text;
  end if;

  -- 4) Código de acceso, solo si la propuesta lo requiere.
  if v_p.access_required then
    select exists (
      select 1
        from public.proposal_access_credentials c
       where c.proposal_id = p_id
         and c.access_code_hash is not null
         and length(c.access_code_hash) > 0
    ) into v_has_code;

    if not v_has_code then
      return query select 4, 'access_code_missing'::text,
                          'Acceso: falta generar el código de acceso (o desmarca «Requiere código de acceso» si esta propuesta no lo necesita).'::text,
                          'client-trip'::text, null::text, null::text, null::text;
    end if;
  end if;
end;
$$;

revoke execute on function public.get_publish_readiness(uuid) from public, anon;
grant execute on function public.get_publish_readiness(uuid) to authenticated;

-- publish_proposal: mismas comprobaciones previas, y los datos que faltan salen de la misma función.
create or replace function public.publish_proposal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text;
  v_problems text;
begin
  if not public.can_manage_proposals() then
    raise exception 'No autorizado';
  end if;

  select p.status into v_status
    from public.proposals p
   where p.id = p_id;

  if not found then
    raise exception 'Propuesta no encontrada';
  end if;

  if v_status <> 'draft' then
    raise exception 'Solo se puede publicar una propuesta en estado draft';
  end if;

  select string_agg(r.message, ' ' order by r."position")
    into v_problems
    from public.get_publish_readiness(p_id) r;

  if v_problems is not null then
    raise exception 'Faltan datos para publicar: %', v_problems;
  end if;

  update public.proposals
     set status = 'published',
         published_at = now()
   where id = p_id;
end;
$$;

commit;
