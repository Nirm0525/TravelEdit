-- Bug preexistente encontrado al probar la subida de imagen en el editor de
-- About: storage.buckets tenía CERO buckets creados en esta base — ni
-- 'destination-images' ni 'site-content-images' ni 'article-covers' existen,
-- aunque las migraciones 0002/0005 los describen y las políticas de
-- storage.objects ya vivas (storage_public_read/storage_staff_insert/update/
-- delete, consolidadas fuera del historial de migraciones) ya los esperan por
-- nombre. Sin el bucket, cualquier subida devuelve 400 ("Bucket not found").
-- Este insert es puramente aditivo: solo crea los buckets, no toca ninguna
-- política ni ningún dato existente.
insert into storage.buckets (id, name, public)
values
  ('destination-images', 'destination-images', true),
  ('site-content-images', 'site-content-images', true),
  ('article-covers', 'article-covers', true)
on conflict (id) do nothing;
