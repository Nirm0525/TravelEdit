-- Módulo: roles y permisos — agrega el rol "staff" y separa los permisos
-- que hoy vivían todos bajo is_staff() (cualquiera de los roles) en
-- permisos por función: contenido/destinos (editor+admin) vs
-- solicitudes (staff+admin). is_staff() se mantiene tal cual para lo que
-- sigue siendo visible a cualquier rol (resolver nombres, actividad).

alter table profiles drop constraint if exists profiles_role_check;
alter table profiles add constraint profiles_role_check check (role in ('admin', 'editor', 'staff'));

create function can_manage_content() returns boolean
language sql stable security definer set search_path = public as $$
  select app_user_role() in ('admin', 'editor')
$$;

create function can_manage_leads() returns boolean
language sql stable security definer set search_path = public as $$
  select app_user_role() in ('admin', 'staff')
$$;

-- ------------------------------------------------------------------
-- destinations / itinerary_days / destination_images: contenido, no
-- solicitudes — is_staff() -> can_manage_content().
-- ------------------------------------------------------------------
drop policy destinations_select on destinations;
drop policy destinations_insert on destinations;
drop policy destinations_update on destinations;

create policy destinations_select on destinations for select
  using (status = 'published' or can_manage_content());
create policy destinations_insert on destinations for insert with check (can_manage_content());
create policy destinations_update on destinations for update using (can_manage_content());

drop policy itinerary_days_select on itinerary_days;
drop policy itinerary_days_all on itinerary_days;

create policy itinerary_days_select on itinerary_days for select
  using (exists (select 1 from destinations d where d.id = destination_id and (d.status = 'published' or can_manage_content())));
create policy itinerary_days_all on itinerary_days for all using (can_manage_content()) with check (can_manage_content());

drop policy destination_images_select on destination_images;
drop policy destination_images_all on destination_images;

create policy destination_images_select on destination_images for select
  using (exists (select 1 from destinations d where d.id = destination_id and (d.status = 'published' or can_manage_content())));
create policy destination_images_all on destination_images for all using (can_manage_content()) with check (can_manage_content());

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

-- ------------------------------------------------------------------
-- leads / lead_notes: solicitudes — is_staff() -> can_manage_leads().
-- ------------------------------------------------------------------
drop policy leads_select on leads;
drop policy leads_update on leads;

create policy leads_select on leads for select using (can_manage_leads());
create policy leads_update on leads for update using (can_manage_leads());

drop policy lead_notes_select on lead_notes;
drop policy lead_notes_insert on lead_notes;

create policy lead_notes_select on lead_notes for select using (can_manage_leads());
create policy lead_notes_insert on lead_notes for insert with check (can_manage_leads() and author_id = auth.uid());

-- ------------------------------------------------------------------
-- site_content: contenido — is_staff() -> can_manage_content(). La
-- lectura pública (site_content_select, using (true)) no cambia.
-- ------------------------------------------------------------------
drop policy site_content_insert on site_content;
drop policy site_content_update on site_content;

create policy site_content_insert on site_content for insert with check (can_manage_content());
create policy site_content_update on site_content for update using (can_manage_content());
