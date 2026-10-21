-- Módulo: Viajes — la importación de PDF conoce el TIPO (proposal | itinerary). Complementa a 0055; NO es 0056 (compartir).
--
-- POR QUÉ UNA COLUMNA: el tipo de una importación debe decidirlo un dato controlado por el backend, no el cuerpo de una solicitud.
-- Se guarda en proposal_imports.kind al subir el PDF (la RLS exige can_travel(kind, 'crear'): nadie crea importaciones de un
-- tipo que no puede crear) y desde ese momento es INMUTABLE. import-proposal-pdf y apply-proposal-import solo LEEN esa columna:
-- qué se extrae, qué se conserva y qué tipo de registro se crea salen de ella. Una importación de propuesta solo produce
-- propuestas y una de itinerario solo itinerarios (guard en la base, abajo, y también en las Edge Functions).
--
-- QUÉ HACE
--   1) proposal_imports.kind ('proposal' | 'itinerary', NOT NULL, DEFAULT 'proposal'). Las filas actuales quedan 'proposal'.
--   2) Un itinerario solo se importa como NUEVO (CHECK): importar sobre un itinerario existente (merge) no existe todavía.
--   3) authenticated puede INSERTAR kind (grant de columna); no hay UPDATE para authenticated, así que no puede cambiarlo.
--      La policy de INSERT conserva TODAS las condiciones reales de producción y añade can_travel(kind, 'crear').
--   4) Triggers: el registro enlazado (proposal_id) debe ser del MISMO tipo que la importación (reemplaza a
--      trg_proposal_imports_only_proposals de 0055, que solo admitía propuestas); y kind no se puede cambiar.
--
-- QUÉ NO HACE: compartir/dejar de compartir un itinerario, vista privada, correo (0056). No toca proposals ni sus policies.
--
-- ORDEN DE DESPLIEGUE: aplicar esta migración ANTES de desplegar las Edge Functions import-proposal-pdf y apply-proposal-import
-- (leen la columna kind) y antes de desplegar el frontend (la sube).
--
-- Aplicar con: supabase db query --linked -f supabase/migrations/0055b_proposal_imports_kind.sql
-- Verificar (solo lectura): supabase db query --linked -f supabase/migration-scripts/0055b_proposal_imports_kind_verify.sql
-- Revertir (a mano): supabase db query --linked -f supabase/migration-scripts/0055b_proposal_imports_kind_rollback.sql
begin;

alter table public.proposal_imports add column kind text not null default 'proposal';

alter table public.proposal_imports
  add constraint proposal_imports_kind_check check (kind in ('proposal', 'itinerary'));

-- Un itinerario se importa siempre como nuevo (merge es de propuestas).
alter table public.proposal_imports
  add constraint proposal_imports_itinerary_new_only check (kind = 'proposal' or mode = 'new');

-- INSERT: las condiciones son las REALES de producción (0049) más el permiso por tipo.
drop policy if exists proposal_imports_insert on public.proposal_imports;
create policy proposal_imports_insert on public.proposal_imports for insert
  with check (
    public.can_manage_proposals()
    and public.can_travel(kind, 'crear')
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

grant insert (kind) on public.proposal_imports to authenticated;

-- Guard de tipo: un registro enlazado a la importación es SIEMPRE de su mismo tipo (propuesta↔propuesta, itinerario↔itinerario).
create or replace function public.enforce_import_kind_match() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.proposal_id is not null
     and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.kind = new.kind) then
    raise exception 'import_kind_mismatch: la importación (%) solo puede enlazarse a un registro de su mismo tipo', new.kind;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_import_kind_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.kind is distinct from old.kind then
    raise exception 'import_kind_immutable: el tipo de una importación no se puede cambiar';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proposal_imports_only_proposals on public.proposal_imports;
drop function if exists public.enforce_import_targets_proposal();

create trigger trg_proposal_imports_same_kind
  before insert or update of proposal_id, kind on public.proposal_imports
  for each row execute function public.enforce_import_kind_match();

create trigger trg_proposal_imports_kind_immutable
  before update of kind on public.proposal_imports
  for each row execute function public.enforce_import_kind_immutable();

-- Funciones de trigger: nadie las ejecuta directamente (solo el motor, al disparar el trigger).
revoke execute on function public.enforce_import_kind_match() from public, anon, authenticated;
revoke execute on function public.enforce_import_kind_immutable() from public, anon, authenticated;

commit;
