-- Módulo: Smart Proposal Builder — auditoría. Mismo mecanismo que
-- destinations/leads/articles (0006/0018/0021): triggers security definer
-- que escriben en audit_log, nunca una llamada desde el cliente Angular
-- (AuditLogService es de solo lectura en todo el proyecto). Nunca se
-- registra el contenido de `content` (HTML/narrativa), solo qué pasó.

create function log_proposal_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_created', 'proposal', new.id::text,
    'Creó la propuesta para "' || new.client_name || '"');
  return new;
end;
$$;

create trigger trg_log_proposal_created
  after insert on proposals
  for each row execute function log_proposal_created();

-- Cubre tanto cambios que hace el staff (publish_proposal/unpublish_proposal
-- en 0032 -> auth.uid() es la asesora) como los que dispara el propio
-- cliente sin sesión de Supabase Auth (get_proposal_content marcando
-- 'viewed', accept_proposal marcando 'accepted' -> auth.uid() es null).
-- 'expired' está en el check constraint de status (0029) para cuando una
-- fase futura decida persistirlo (p. ej. un job); en esta fase la
-- expiración es puramente calculada al leer (ver get_proposal_gate/
-- get_proposal_content en 0031), ningún código de esta fase escribe
-- status='expired', así que esa rama del CASE queda sin uso por ahora.
create function log_proposal_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_summary text;
begin
  v_summary := case new.status
    when 'published' then 'Publicó la propuesta'
    when 'viewed' then 'El cliente visualizó la propuesta'
    when 'accepted' then 'El cliente aceptó la propuesta'
    when 'expired' then 'La propuesta expiró'
    when 'draft' then 'Despublicó la propuesta'
    else 'Actualizó el estado de la propuesta'
  end;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_status_changed', 'proposal', new.id::text,
    v_summary || ' de "' || new.client_name || '"');

  return new;
end;
$$;

create trigger trg_log_proposal_status_change
  after update on proposals
  for each row
  when (old.status is distinct from new.status)
  execute function log_proposal_status_change();

create function log_proposal_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'proposal_deleted', 'proposal', old.id::text,
    'Eliminó la propuesta de "' || old.client_name || '"');
  return old;
end;
$$;

create trigger trg_log_proposal_deleted
  after delete on proposals
  for each row execute function log_proposal_deleted();
