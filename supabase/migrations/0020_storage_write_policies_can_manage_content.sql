-- Corrige un hallazgo de la auditoría funcional del admin: las políticas de
-- escritura sobre storage.objects para los buckets de imágenes del sitio
-- (destination-images, article-covers, site-content-images) seguían usando
-- is_staff() (cualquier rol con perfil: admin/editor/staff), mientras que
-- las tablas relacionadas (destinations, itinerary_days, destination_images,
-- site_content) ya fueron migradas en 0007_roles_permissions.sql a
-- can_manage_content() (solo admin/editor). El rol "staff" (pensado
-- únicamente para gestionar solicitudes/leads, sin acceso de UI a
-- destinos/contenido) podía igualmente subir, sobrescribir o borrar
-- archivos en esos buckets llamando directo a la Storage API de Supabase,
-- sin pasar por RLS de tabla ni por el guard de navegación del frontend.
--
-- Los nombres reales de estas políticas en producción (storage_public_read /
-- storage_staff_insert / storage_staff_update / storage_staff_delete) NO
-- coinciden con los nombres usados en 0002/0005 (destination_images_storage_*,
-- site_content_images_storage_*) — confirmado consultando pg_policies contra
-- la base real antes de escribir esta migración, tal como advierte el
-- comentario de 0013_create_missing_storage_buckets.sql. Esta migración usa
-- los nombres reales.
--
-- No se toca storage_public_read (SELECT): la lectura pública de estos
-- buckets es intencional (imágenes servidas al sitio público sin login).

drop policy if exists storage_staff_insert on storage.objects;
drop policy if exists storage_staff_update on storage.objects;
drop policy if exists storage_staff_delete on storage.objects;

create policy storage_staff_insert on storage.objects for insert
  with check (
    bucket_id in ('destination-images', 'article-covers', 'site-content-images')
    and public.can_manage_content()
  );

create policy storage_staff_update on storage.objects for update
  using (
    bucket_id in ('destination-images', 'article-covers', 'site-content-images')
    and public.can_manage_content()
  );

create policy storage_staff_delete on storage.objects for delete
  using (
    bucket_id in ('destination-images', 'article-covers', 'site-content-images')
    and public.can_manage_content()
  );
