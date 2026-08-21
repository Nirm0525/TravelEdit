-- Módulo: destinos e itinerarios

create table destinations (
  id                 uuid primary key default gen_random_uuid(),
  slug               text unique not null,
  title              text not null,
  country_region     text not null,
  trip_type          text not null default 'otro'
                       check (trip_type in ('safari','islas','ciudad','ruta_cultural','aventura','bienestar','otro')),
  duration_days      int not null default 1 check (duration_days > 0),
  season             text check (season in ('todo_el_año','primavera','verano','otoño','invierno')),
  price_range_min    numeric,
  price_range_max    numeric,
  short_description  text not null default '',
  long_description   text not null default '',
  status             text not null default 'draft' check (status in ('draft','published','archived')),
  cover_image_id     uuid,
  created_by         uuid references profiles(id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  published_at       timestamptz
);

create table itinerary_days (
  id                    uuid primary key default gen_random_uuid(),
  destination_id        uuid not null references destinations(id) on delete cascade,
  position              int not null,
  title                 text not null,
  description           text not null,
  accommodation         text,
  included_experiences  text[] not null default '{}',
  unique (destination_id, position) deferrable initially deferred
);

create table destination_images (
  id              uuid primary key default gen_random_uuid(),
  destination_id  uuid not null references destinations(id) on delete cascade,
  storage_path    text not null,
  alt_text        text not null,
  position        int not null,
  created_at      timestamptz not null default now(),
  unique (id, destination_id)
);

alter table destinations add constraint destinations_cover_image_fk
  foreign key (cover_image_id, id) references destination_images (id, destination_id);
  -- sin ON DELETE: borrar la imagen-portada debe fallar explícito. La app limpia
  -- cover_image_id primero, en la misma operación, si el staff insiste en borrarla.

-- ------------------------------------------------------------------
-- Reordenar días: PostgREST no da transacciones multi-request, así que
-- una secuencia de UPDATEs desde el cliente NO es atómica (cada .update()
-- de supabase-js es su propia transacción) — el constraint diferido de
-- arriba no ayudaría nada si el reorden viniera del cliente request por
-- request. Por eso el reorden completo vive en una función: una sola
-- llamada RPC, una sola transacción real.
-- ------------------------------------------------------------------
create function reorder_itinerary_days(p_destination_id uuid, p_ordered_ids uuid[])
returns void
language plpgsql security invoker set search_path = public as $$
declare
  v_id uuid;
  v_position int := 0;
begin
  if not is_staff() then
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

alter table destinations enable row level security;
alter table itinerary_days enable row level security;
alter table destination_images enable row level security;

create policy destinations_select on destinations for select
  using (status = 'published' or is_staff());
create policy destinations_insert on destinations for insert with check (is_staff());
create policy destinations_update on destinations for update using (is_staff());
create policy destinations_delete on destinations for delete using (app_user_role() = 'admin');

create policy itinerary_days_select on itinerary_days for select
  using (exists (select 1 from destinations d where d.id = destination_id and (d.status = 'published' or is_staff())));
create policy itinerary_days_all on itinerary_days for all using (is_staff()) with check (is_staff());

create policy destination_images_select on destination_images for select
  using (exists (select 1 from destinations d where d.id = destination_id and (d.status = 'published' or is_staff())));
create policy destination_images_all on destination_images for all using (is_staff()) with check (is_staff());

-- long_description solo se escribe sanitizada, vía la Edge Function
-- save-rich-content (service role) — igual que quedó acordado para articles.body.
revoke update (long_description) on destinations from authenticated;

create index idx_destinations_status on destinations (status);
create index idx_destination_images_dest_pos on destination_images (destination_id, position);

create function set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_destinations_updated_at before update on destinations for each row execute function set_updated_at();

-- ------------------------------------------------------------------
-- Storage: bucket de imágenes de destinos, lectura pública, escritura staff.
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('destination-images', 'destination-images', true)
  on conflict (id) do nothing;

create policy destination_images_storage_read on storage.objects for select
  using (bucket_id = 'destination-images');
create policy destination_images_storage_insert on storage.objects for insert
  with check (bucket_id = 'destination-images' and is_staff());
create policy destination_images_storage_update on storage.objects for update
  using (bucket_id = 'destination-images' and is_staff());
create policy destination_images_storage_delete on storage.objects for delete
  using (bucket_id = 'destination-images' and is_staff());
