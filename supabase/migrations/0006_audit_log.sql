-- Módulo: auditoría — registro de acciones administrativas relevantes.
-- Aditivo: no toca tablas, columnas ni políticas existentes.

create table audit_log (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references profiles(id),
  action       text not null,
  entity_type  text not null,
  entity_id    text,
  summary      text not null,
  created_at   timestamptz not null default now()
);

alter table audit_log enable row level security;

create policy audit_log_select on audit_log for select using (is_staff());
-- Sin insert/update/delete para authenticated: solo escriben las funciones
-- trigger de abajo (security definer), igual que handle_new_user /
-- prevent_role_self_escalation en 0001_auth.sql.

create index idx_audit_log_created_at on audit_log (created_at desc);

-- ------------------------------------------------------------------
-- destinations: registra cambios de estado (draft/published/archived).
-- ------------------------------------------------------------------
create function log_destination_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_summary text;
begin
  if new.status = 'published' then
    v_summary := 'Publicó "' || new.title || '"';
  elsif new.status = 'archived' then
    v_summary := 'Archivó "' || new.title || '"';
  else
    v_summary := 'Regresó "' || new.title || '" a borrador';
  end if;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'destination_status_changed', 'destination', new.id::text, v_summary);

  return new;
end;
$$;

create trigger trg_log_destination_status_change
  after update on destinations
  for each row
  when (old.status is distinct from new.status)
  execute function log_destination_status_change();

-- ------------------------------------------------------------------
-- leads: registra cambios de estado.
-- ------------------------------------------------------------------
create function log_lead_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_status_label text;
begin
  v_status_label := case new.status
    when 'contactada' then 'Marcó como contactada'
    when 'propuesta_enviada' then 'Marcó como propuesta enviada'
    when 'cerrada_ganada' then 'Marcó como cerrada (ganada)'
    when 'cerrada_perdida' then 'Marcó como cerrada (perdida)'
    else 'Marcó como nueva'
  end;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    'lead_status_changed',
    'lead',
    new.id::text,
    v_status_label || ' la solicitud de "' || new.name || '"'
  );

  return new;
end;
$$;

create trigger trg_log_lead_status_change
  after update on leads
  for each row
  when (old.status is distinct from new.status)
  execute function log_lead_status_change();

-- ------------------------------------------------------------------
-- site_content: registra cada actualización de una sección.
-- ------------------------------------------------------------------
create function log_site_content_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    'site_content_updated',
    'site_content',
    new.section,
    'Actualizó la sección "' || new.section || '"'
  );

  return new;
end;
$$;

create trigger trg_log_site_content_update
  after update on site_content
  for each row
  execute function log_site_content_update();
