-- La Edge Function admin-users necesita poder cambiar profiles.role usando
-- la service role (crear/editar usuarios) — prevent_role_self_escalation()
-- bloqueaba eso porque auth.uid() es NULL en una conexión service_role,
-- así que app_user_role() resolvía a NULL y el trigger lo rechazaba igual
-- que un auto-ascenso. La función ya valida ella misma que quien llama es
-- admin antes de tocar la base, así que permitir explícitamente a
-- service_role aquí no abre ningún hueco nuevo. No se toca la tabla, RLS,
-- ni ninguna otra función.

create or replace function prevent_role_self_escalation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_user = 'service_role' then
    return new;
  end if;

  if new.role is distinct from old.role and app_user_role() is distinct from 'admin' then
    raise exception 'Solo un admin puede cambiar el rol de un usuario';
  end if;
  return new;
end;
$$;
