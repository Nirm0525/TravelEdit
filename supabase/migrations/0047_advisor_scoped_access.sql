-- Módulo: rol Asesora — el rol 'staff' pasa a ser la Asesora del panel: ve y
-- trabaja SOLO sus solicitudes (leads.assigned_to) y SUS propuestas
-- (proposals.advisor_id). admin y editor siguen viendo todo. La jefa (admin)
-- asigna cada solicitud a una asesora desde el detalle de la solicitud.
--
-- La restricción vive aquí, en la base de datos, no solo en la pantalla:
--   1) policies RLS (qué filas puede leer/escribir cada asesora), y
--   2) triggers (impiden reasignarse leads/propuestas ajenos aunque la
--      escritura llegue por una RPC security definer como publish_proposal).
-- NOTA: en producción app_user_role() vive en el schema `private` y los helpers
-- corren con search_path vacío (como can_manage_leads/can_manage_proposals),
-- por eso todo va calificado. Las funciones de service role (edge functions) y anon (cliente público) no
-- tienen app_user_role() y quedan fuera de estas reglas.

-- ¿Puede el usuario actual ver/tocar una fila cuyo dueño es p_owner?
-- Asesora (staff): solo si ella es la dueña. Admin/editor: siempre.
create or replace function public.is_own_or_full(p_owner uuid) returns boolean
language sql stable set search_path = '' as $$
  select case
    when private.app_user_role() = 'staff' then p_owner is not null and p_owner = auth.uid()
    else true
  end
$$;

grant execute on function public.is_own_or_full(uuid) to authenticated;

-- ------------------------------------------------------------------
-- leads / lead_notes
-- ------------------------------------------------------------------
drop policy if exists leads_select on leads;
drop policy if exists leads_update on leads;
create policy leads_select on leads for select
  using (can_manage_leads() and is_own_or_full(assigned_to));
create policy leads_update on leads for update
  using (can_manage_leads() and is_own_or_full(assigned_to));

-- Las notas heredan la visibilidad del lead (el subselect pasa por leads_select).
drop policy if exists lead_notes_select on lead_notes;
drop policy if exists lead_notes_insert on lead_notes;
create policy lead_notes_select on lead_notes for select
  using (can_manage_leads() and exists (select 1 from public.leads l where l.id = lead_id));
create policy lead_notes_insert on lead_notes for insert
  with check (can_manage_leads() and author_id = auth.uid() and exists (select 1 from public.leads l where l.id = lead_id));

-- Una asesora no puede reasignar ni quitarse una solicitud: solo admin/editor.
create or replace function public.enforce_lead_assignment() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.app_user_role() = 'staff'
     and (old.assigned_to is distinct from auth.uid() or new.assigned_to is distinct from old.assigned_to) then
    raise exception 'No autorizado: solo la administradora puede reasignar solicitudes';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_lead_assignment on leads;
create trigger trg_enforce_lead_assignment before update on leads
  for each row execute function public.enforce_lead_assignment();

-- ------------------------------------------------------------------
-- proposals
-- ------------------------------------------------------------------
drop policy if exists proposals_select on proposals;
drop policy if exists proposals_insert on proposals;
drop policy if exists proposals_update on proposals;
create policy proposals_select on proposals for select
  using (can_manage_proposals() and is_own_or_full(advisor_id));
create policy proposals_insert on proposals for insert
  with check (can_manage_proposals() and created_by = auth.uid());
create policy proposals_update on proposals for update
  using (can_manage_proposals() and is_own_or_full(advisor_id));

-- Toda propuesta nace con asesora: la del lead de origen, o quien la crea.
-- Una asesora solo puede crear/editar propuestas propias, incluso a través de
-- las RPC security definer (publish_proposal, unpublish_proposal…).
create or replace function public.enforce_proposal_advisor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.advisor_id is null then
      new.advisor_id := coalesce((select l.assigned_to from public.leads l where l.id = new.lead_id), auth.uid());
    end if;
    if private.app_user_role() = 'staff' and new.advisor_id is distinct from auth.uid() then
      raise exception 'No autorizado: la propuesta debe quedar a nombre de la asesora que la crea';
    end if;
    return new;
  end if;

  if private.app_user_role() = 'staff'
     and (old.advisor_id is distinct from auth.uid() or new.advisor_id is distinct from old.advisor_id) then
    raise exception 'No autorizado: esta propuesta pertenece a otra asesora';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_proposal_advisor on proposals;
create trigger trg_enforce_proposal_advisor before insert or update on proposals
  for each row execute function public.enforce_proposal_advisor();

-- Código de acceso: set_proposal_access_code es security definer y escribe en
-- proposal_access_credentials, no en proposals — se protege aquí.
create or replace function public.enforce_credential_ownership() returns trigger
language plpgsql set search_path = '' as $$
begin
  if private.app_user_role() = 'staff'
     and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.advisor_id = auth.uid()) then
    raise exception 'No autorizado: esta propuesta pertenece a otra asesora';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_credential_ownership on proposal_access_credentials;
create trigger trg_enforce_credential_ownership before insert or update on proposal_access_credentials
  for each row execute function public.enforce_credential_ownership();

-- Propuestas existentes sin asesora: heredan la del lead, o quien las creó.
-- (Se desactiva el trigger solo durante este backfill, que corre como admin de
-- base de datos y no como asesora.)
alter table proposals disable trigger trg_enforce_proposal_advisor;
update proposals p
  set advisor_id = coalesce((select l.assigned_to from public.leads l where l.id = p.lead_id), p.created_by)
  where p.advisor_id is null;
alter table proposals enable trigger trg_enforce_proposal_advisor;
