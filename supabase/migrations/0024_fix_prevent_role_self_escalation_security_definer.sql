-- Fix: crear un usuario con un rol distinto de "editor" (el default de
-- handle_new_user) fallaba siempre con "El usuario se creó, pero no se pudo
-- asignar el rol solicitado." — el mismo bug bloqueaba también cambiar el
-- rol de un usuario ya existente desde el panel.
--
-- Causa raíz verificada en vivo: prevent_role_self_escalation() (0009) tiene
-- un bypass explícito para la Edge Function admin-users ("if current_user =
-- 'service_role' then return new"), pero la función está declarada
-- `security definer` — y dentro de una función security definer,
-- `current_user` deja de ser quien realmente ejecutó el UPDATE: pasa a ser
-- el DUEÑO de la función. El bypass para service_role nunca podía ser
-- cierto, sin importar quién llamara. Reproducido:
--   set local role service_role;
--   update profiles set role = 'admin' where id = '<uuid>';
--   -> ERROR P0001: Solo un admin puede cambiar el rol de un usuario
--
-- Este trigger no necesita privilegio elevado propio — compara NEW/OLD (ya
-- disponibles sin permisos especiales) y delega en app_user_role(), que ya
-- es security definer por su cuenta para leer profiles saltándose RLS. Basta
-- con quitarle `security definer` a prevent_role_self_escalation() para que
-- current_user adentro refleje a quien realmente llamó (service_role para
-- la Edge Function, authenticated para cualquier otro caso) — el cuerpo de
-- la función no cambia.
--
-- Verificado que la protección real sigue intacta: un usuario authenticated
-- sin rol admin que intenta cambiar su propio rol sigue bloqueado con el
-- mismo error.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security invoker
set search_path to 'public'
as $function$
begin
  -- Las operaciones administrativas realizadas por la Edge Function
  -- con service_role ya fueron autorizadas en backend.
  if current_user = 'service_role' then
    return new;
  end if;

  -- Los cambios normales de rol solo los puede realizar un admin.
  if new.role is distinct from old.role
     and public.app_user_role() is distinct from 'admin' then
    raise exception 'Solo un admin puede cambiar el rol de un usuario';
  end if;

  return new;
end;
$function$;
