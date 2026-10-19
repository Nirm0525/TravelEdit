-- Reversión de 0049. Borra los PDF subidos y el historial de importaciones.
-- Los objetos del bucket deben vaciarse antes desde la API de Storage (Postgres
-- no deja borrar un bucket con objetos).
-- Si Supabase bloquea el delete directo de storage.buckets, vaciar y borrar el
-- bucket desde la API de Storage (emptyBucket / deleteBucket) y volver a correr
-- el resto de este archivo.
begin;
drop policy if exists proposal_imports_storage_insert on storage.objects;
drop policy if exists proposal_imports_storage_read on storage.objects;
delete from storage.buckets where id = 'proposal-imports';
drop table if exists public.proposal_imports;
alter table public.proposals drop constraint if exists proposals_origin_channel_check;
alter table public.proposals drop column if exists origin_channel, drop column if exists client_phone;
commit;
