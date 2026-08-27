-- Módulo: auditoría — registra la eliminación de solicitudes de leads.
-- Aditivo: no toca tablas, columnas ni políticas existentes. Reutiliza
-- audit_log (ver 0006_audit_log.sql), mismo patrón que log_lead_status_change.

create function log_lead_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    'lead_deleted',
    'lead',
    old.id::text,
    'Eliminó la solicitud de "' || old.name || '"'
  );

  return old;
end;
$$;

create trigger trg_log_lead_deleted
  after delete on leads
  for each row
  execute function log_lead_deleted();
