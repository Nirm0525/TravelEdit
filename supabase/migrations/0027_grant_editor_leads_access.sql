-- El equipo pidió que el rol 'editor' también pueda ver y gestionar
-- solicitudes (leads) — antes can_manage_leads() solo admitía admin/staff.
-- Esto es aditivo: no se toca ninguna policy ni ninguna otra función, solo
-- se amplía el resultado de can_manage_leads() para incluir 'editor'. Todo lo
-- que ya dependía de esta función (leads_select/leads_update en
-- 0007_roles_permissions.sql, lead_notes_select/lead_notes_insert, y la
-- Edge Function send-proposal) queda accesible para editor sin más cambios.
create or replace function public.can_manage_leads() returns boolean
language sql stable security definer set search_path = public as $$
  select public.app_user_role() in ('admin', 'staff', 'editor');
$$;
