-- Reversión de 0055b (proposal_imports.kind). Restaura el estado de 0055: importación EXCLUSIVA de propuestas.
-- DESTRUCTIVA: borra la columna kind. Se NIEGA a ejecutarse si existe al menos una importación de itinerario
-- (kind = 'itinerary'): perdería su tipo y el apply podría crear una propuesta con lo extraído.
-- Ejecutar a mano (NO es una migración):
--   supabase db query --linked -f supabase/migration-scripts/0055b_proposal_imports_kind_rollback.sql
begin;

do $$
begin
  if exists (select 1 from public.proposal_imports where kind = 'itinerary') then
    raise exception 'Hay importaciones de itinerario (kind = itinerary): no se revierte 0055b. Elimínalas antes.';
  end if;
end $$;

drop trigger if exists trg_proposal_imports_kind_immutable on public.proposal_imports;
drop trigger if exists trg_proposal_imports_same_kind on public.proposal_imports;
drop function if exists public.enforce_import_kind_immutable();
drop function if exists public.enforce_import_kind_match();

-- Trigger y función de 0055: el registro enlazado debe ser una propuesta.
create or replace function public.enforce_import_targets_proposal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.proposal_id is not null
     and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.kind = 'proposal') then
    raise exception 'import_requires_proposal: la importación de PDF solo aplica a propuestas';
  end if;
  return new;
end;
$$;

create trigger trg_proposal_imports_only_proposals
  before insert or update of proposal_id on public.proposal_imports
  for each row execute function public.enforce_import_targets_proposal();

revoke execute on function public.enforce_import_targets_proposal() from public, anon, authenticated;

-- Policy de INSERT real de producción (sin el permiso por tipo).
drop policy if exists proposal_imports_insert on public.proposal_imports;
create policy proposal_imports_insert on public.proposal_imports for insert
  with check (
    public.can_manage_proposals()
    and created_by = auth.uid()
    and status = 'uploaded'
    and extracted is null and diff is null and error is null and applied_at is null
    and (
      proposal_id is null
      or exists (
        select 1 from public.proposals p
        where p.id = proposal_id and public.is_own_or_full(p.advisor_id)
      )
    )
    and file_path ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$')
  );

alter table public.proposal_imports drop constraint if exists proposal_imports_itinerary_new_only;
alter table public.proposal_imports drop constraint if exists proposal_imports_kind_check;
-- Al borrar la columna se va también el grant de columna sobre kind.
alter table public.proposal_imports drop column if exists kind;

commit;
