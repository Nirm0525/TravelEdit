-- Módulo: Smart Proposal Builder — bucket de imágenes editoriales.
--
-- proposal-images solo debe contener fotografía editorial reutilizable en
-- una propuesta (hoteles, ciudades, vehículos, experiencias, restaurantes)
-- — NUNCA documentos personales, pasaportes ni vouchers privados. La
-- restricción técnica que este archivo aplica de verdad es el allowlist de
-- tipos MIME (bloquea PDFs y cualquier archivo que no sea imagen); que una
-- imagen sea "editorial" y no, por ejemplo, la foto de un pasaporte, es una
-- restricción de proceso/UI (el builder admin no debe ofrecer nunca un
-- selector de archivos genérico en este módulo, solo un uploader de fotos de
-- catálogo, igual que article-images.ts/site-content-images.ts) — el tipo
-- MIME por sí solo no puede garantizar el contenido semántico de la imagen.
insert into storage.buckets (id, name, public, allowed_mime_types)
values ('proposal-images', 'proposal-images', true, array['image/webp','image/jpeg','image/png'])
on conflict (id) do nothing;

-- Lectura pública (igual que destination-images/article-covers/
-- site-content-images: son imágenes servidas al sitio público, sin login).
-- Escritura restringida a can_manage_proposals(), mismo criterio que
-- storage_staff_insert/update/delete en 0020_storage_write_policies_can_manage_content.sql
-- aplican can_manage_content() a los otros tres buckets.
create policy proposal_images_storage_read on storage.objects for select
  using (bucket_id = 'proposal-images');

create policy proposal_images_storage_insert on storage.objects for insert
  with check (bucket_id = 'proposal-images' and can_manage_proposals());

create policy proposal_images_storage_update on storage.objects for update
  using (bucket_id = 'proposal-images' and can_manage_proposals());

create policy proposal_images_storage_delete on storage.objects for delete
  using (bucket_id = 'proposal-images' and can_manage_proposals());
