-- La tabla site_content en producción usa "section_key" (no "section" como
-- describía 0005_site_content.sql originalmente) — la función de auditoría
-- de 0006_audit_log.sql quedó apuntando a una columna que no existe,
-- rompiendo con error 42703 cualquier UPDATE a site_content vía el trigger.
-- Solo se corrige la función; no se toca la tabla, RLS ni otros roles.

create or replace function log_site_content_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    'site_content_updated',
    'site_content',
    new.section_key,
    'Actualizó la sección "' || new.section_key || '"'
  );

  return new;
end;
$$;
