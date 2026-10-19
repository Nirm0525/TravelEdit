-- Módulo: Smart Proposal Builder — importación de PDF: bloqueo atómico y procesos atascados.
--
-- La Edge Function import-proposal-pdf trabaja en segundo plano. Si el runtime
-- la mata a mitad de camino, la fila quedaría en 'processing' para siempre: no
-- se podría reintentar (409) y contaría contra el límite de importaciones en
-- curso por usuario. `processing_started_at` marca cuándo empezó el proceso.
--
-- Toda la lógica de tiempo vive en la base y usa su reloj (now()), no el del
-- runtime de la función:
--   private.proposal_import_stale_after()   → constante: 10 minutos.
--   private.claim_proposal_import(id)       → bloqueo atómico (UPDATE ... RETURNING).
--   private.count_active_proposal_imports() → límite de 3 en curso por usuario.
--
-- Solo service_role puede ejecutar estas funciones (revoke a public/anon/authenticated).
-- Viven en `private`, que PostgREST no expone: la Edge Function las llama por su
-- conexión directa a Postgres (SUPABASE_DB_URL).
-- Solo la service role escribe processing_started_at: authenticated no tiene INSERT ni
-- UPDATE sobre ella (0049 solo concede INSERT sobre proposal_id, file_path, mode y created_by).
begin;

create schema if not exists private;

alter table public.proposal_imports
  add column if not exists processing_started_at timestamptz;

-- Cuánto tiempo se considera "en curso" una importación en 'processing'. Pasado este
-- tiempo sin terminar, la fila se trata como atascada: deja de contar contra el límite
-- de en curso y el bloqueo atómico permite retomarla. Debe ser mucho mayor que el plazo
-- del proceso (PROCESS_DEADLINE_MS, ~2 min), que lo corta solo.
create or replace function private.proposal_import_stale_after()
returns interval
language sql
immutable
set search_path = ''
as $$ select interval '10 minutes' $$;

-- Bloqueo atómico: pasa la importación a 'processing' si estaba en 'uploaded' o 'failed',
-- o si estaba en 'processing' pero atascada (sin inicio registrado o de hace más de 10
-- minutos). Devuelve la fila actualizada, o null si no se pudo tomar (la función responde 409).
create or replace function private.claim_proposal_import(p_import_id uuid)
returns public.proposal_imports
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.proposal_imports;
begin
  update public.proposal_imports
     set status = 'processing',
         processing_started_at = now(),
         error = null
   where id = p_import_id
     and (
       status in ('uploaded', 'failed')
       or (
         status = 'processing'
         and (processing_started_at is null or processing_started_at < now() - private.proposal_import_stale_after())
       )
     )
  returning * into v_row;

  if not found then
    return null;
  end if;
  return v_row;
end;
$$;

-- Importaciones en curso del usuario: 'processing' iniciadas dentro de la ventana de 10 minutos.
create or replace function private.count_active_proposal_imports(p_user_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
    from public.proposal_imports
   where created_by = p_user_id
     and status = 'processing'
     and processing_started_at >= now() - private.proposal_import_stale_after()
$$;

revoke execute on function private.proposal_import_stale_after() from public, anon, authenticated;
revoke execute on function private.claim_proposal_import(uuid) from public, anon, authenticated;
revoke execute on function private.count_active_proposal_imports(uuid) from public, anon, authenticated;

grant execute on function private.proposal_import_stale_after() to service_role;
grant execute on function private.claim_proposal_import(uuid) to service_role;
grant execute on function private.count_active_proposal_imports(uuid) to service_role;

commit;
