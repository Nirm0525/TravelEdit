-- Módulo: contenido del sitio público, editable desde el panel (por secciones).
-- Empieza con "hero"; cada sección futura (about, travel-process, etc.) es
-- una fila nueva en la misma tabla, sin migraciones adicionales.

create table site_content (
  section     text primary key,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

create trigger trg_site_content_updated_at
  before update on site_content
  for each row execute function set_updated_at();

insert into site_content (section, data) values (
  'hero',
  jsonb_build_object(
    'eyebrow', 'Bespoke Travel Experiences',
    'titleLine1', 'Because',
    'titleLine2', 'luxury',
    'titleLine3', 'is personal.',
    'lead', 'Viajes diseñados a tu manera.' || chr(10) ||
            'Cuidando cada detalle para que cada experiencia. Se sienta realmente tuya.',
    'ctaLabel', 'DISEÑA TU VIAJE',
    'exploreLabel', 'EXPLORE',
    'imageUrl', 'https://images.unsplash.com/photo-1583844056361-4418a8f2a985?q=80&w=2400&h=1350&fit=crop&auto=format',
    'imageAlt', 'Vista panorámica de Positano en la Costa Amalfitana durante la hora azul, con el pueblo iluminado sobre el mar Tirreno'
  )
) on conflict (section) do nothing;

alter table site_content enable row level security;

create policy site_content_select on site_content for select using (true);
create policy site_content_insert on site_content for insert with check (is_staff());
create policy site_content_update on site_content for update using (is_staff());

-- ------------------------------------------------------------------
-- Storage: imágenes de contenido del sitio (hero y las secciones que sigan),
-- lectura pública, escritura staff — mismo patrón que destination-images.
-- ------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('site-content-images', 'site-content-images', true)
  on conflict (id) do nothing;

create policy site_content_images_storage_read on storage.objects for select
  using (bucket_id = 'site-content-images');
create policy site_content_images_storage_insert on storage.objects for insert
  with check (bucket_id = 'site-content-images' and is_staff());
create policy site_content_images_storage_update on storage.objects for update
  using (bucket_id = 'site-content-images' and is_staff());
create policy site_content_images_storage_delete on storage.objects for delete
  using (bucket_id = 'site-content-images' and is_staff());
