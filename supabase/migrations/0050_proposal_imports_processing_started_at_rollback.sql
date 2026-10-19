-- Reversión de 0050. La Edge Function import-proposal-pdf desplegada con el
-- cambio de 0050 deja de funcionar sin estas funciones y sin la columna:
-- revierte primero la función. No borra el schema `private` (ya existía).
begin;
drop function if exists private.count_active_proposal_imports(uuid);
drop function if exists private.claim_proposal_import(uuid);
drop function if exists private.proposal_import_stale_after();
alter table public.proposal_imports drop column if exists processing_started_at;
commit;
