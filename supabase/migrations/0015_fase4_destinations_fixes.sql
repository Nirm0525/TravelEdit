-- Fase 4: dos bugs de producción encontrados al auditar la base REAL (no las
-- migraciones) contra el módulo de destinos, más auditoría granular nueva.
--
-- 1) reorder_itinerary_days no existe en la base real — el botón de
--    reordenar itinerario del admin la invoca por RPC y hoy falla. Se recrea
--    igual que en 0002, pero con can_manage_content() en vez de is_staff():
--    esa es la convención real vigente en destinations/itinerary_days/
--    destination_images (confirmado con pg_policies), no la de la migración
--    original.
create or replace function reorder_itinerary_days(p_destination_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_position int := 0;
begin
  if not can_manage_content() then
    raise exception 'No autorizado';
  end if;

  foreach v_id in array p_ordered_ids loop
    update itinerary_days
      set position = v_position
      where id = v_id and destination_id = p_destination_id;
    v_position := v_position + 1;
  end loop;
end;
$$;

revoke execute on function reorder_itinerary_days(uuid, uuid[]) from public;
grant execute on function reorder_itinerary_days(uuid, uuid[]) to authenticated;

-- 2) No existe ninguna política de DELETE en destinations — "Eliminar
--    destino" hoy no borra nada (RLS deniega por defecto sin política).
--    Solo admin, igual que la intención original de la migración 0002.
drop policy if exists destinations_delete on destinations;
create policy destinations_delete on destinations for delete using (app_user_role() = 'admin');

-- 3) Auditoría granular nueva — mismo patrón exacto que ya usa
--    log_destination_status_change (security definer, set search_path,
--    insert directo en audit_log). "featured_destinations_updated" no
--    necesita trigger propio: ya lo cubre el trigger genérico existente de
--    site_content (site_content_updated, entity_id = 'destinos_destacados').

create function log_destination_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'destination_created', 'destination', new.id::text, 'Creó "' || new.title || '"');
  return new;
end;
$$;

create trigger trg_log_destination_created
  after insert on destinations
  for each row execute function log_destination_created();

create function log_destination_details_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'destination_updated', 'destination', new.id::text, 'Editó "' || new.title || '"');
  return new;
end;
$$;

create trigger trg_log_destination_details_change
  after update on destinations
  for each row
  when (
    old.title is distinct from new.title
    or old.slug is distinct from new.slug
    or old.country_region is distinct from new.country_region
    or old.trip_type is distinct from new.trip_type
    or old.duration_days is distinct from new.duration_days
    or old.season is distinct from new.season
    or old.price_range_min is distinct from new.price_range_min
    or old.price_range_max is distinct from new.price_range_max
    or old.short_description is distinct from new.short_description
    or old.long_description is distinct from new.long_description
    or old.cover_image_id is distinct from new.cover_image_id
  )
  execute function log_destination_details_change();

create function log_destination_image_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_destination_id uuid;
  v_action text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_destination_id := new.destination_id;
    v_action := 'destination_image_uploaded';
    v_summary := 'Subió una imagen a un destino';
  else
    v_destination_id := old.destination_id;
    v_action := 'destination_image_deleted';
    v_summary := 'Eliminó una imagen de un destino';
  end if;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), v_action, 'destination', v_destination_id::text, v_summary);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_log_destination_image_change
  after insert or delete on destination_images
  for each row execute function log_destination_image_change();

create function log_itinerary_day_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_row record;
  v_action text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_row := new;
    v_action := 'itinerary_created';
    v_summary := 'Agregó un día al itinerario: "' || coalesce(new.title, '') || '"';
  elsif tg_op = 'UPDATE' then
    v_row := new;
    v_action := 'itinerary_updated';
    v_summary := 'Editó un día del itinerario: "' || coalesce(new.title, '') || '"';
  else
    v_row := old;
    v_action := 'itinerary_deleted';
    v_summary := 'Eliminó un día del itinerario: "' || coalesce(old.title, '') || '"';
  end if;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), v_action, 'destination', v_row.destination_id::text, v_summary);

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger trg_log_itinerary_day_insert
  after insert on itinerary_days
  for each row execute function log_itinerary_day_change();

-- Solo audita ediciones de contenido real, no cada reorder de posición
-- (reorder_itinerary_days actualiza `position` en cada fila movida; auditar
-- eso como "itinerary_updated" sería ruido, no información útil).
create trigger trg_log_itinerary_day_update
  after update on itinerary_days
  for each row
  when (
    old.title is distinct from new.title
    or old.description is distinct from new.description
    or old.accommodation is distinct from new.accommodation
    or old.included_experiences is distinct from new.included_experiences
  )
  execute function log_itinerary_day_change();

create trigger trg_log_itinerary_day_delete
  after delete on itinerary_days
  for each row execute function log_itinerary_day_change();
