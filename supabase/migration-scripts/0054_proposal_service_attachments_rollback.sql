-- Reversión de 0054. Borra la metadata de los documentos adjuntos y el bucket.
-- Postgres no deja borrar un bucket con objetos: si hay archivos, esta reversión falla y NO borra nada.
-- Vaciar antes el bucket desde la API de Storage (emptyBucket) y volver a correr este archivo.
-- Ejecutar a mano (NO es una migración; por eso vive fuera de supabase/migrations):
--   supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_rollback.sql
begin;
do $$
begin
  if exists (select 1 from storage.objects where bucket_id = 'proposal-service-files') then
    raise exception 'El bucket proposal-service-files todavía tiene archivos: vaciarlo desde la API de Storage antes de revertir.';
  end if;
end $$;
delete from storage.buckets where id = 'proposal-service-files';
drop table if exists public.proposal_service_attachments;
drop function if exists public.enforce_service_attachment();
commit;
