-- Fix: ningún usuario logueado (rol `authenticated`) podía usar el panel
-- admin — el login se quedaba colgado en "Entrando..." y la consola
-- mostraba 403 en /rest/v1/profiles.
--
-- Causa raíz verificada en vivo (misma clase de bug que 0012 y 0022, pero
-- del lado de `authenticated` en vez de `anon`):
--   select id, full_name, role from profiles where id = auth.uid();
--   -> ERROR 42501: permission denied for function is_staff
--
-- `app_user_role()`, `is_staff()`, `can_manage_content()` y
-- `can_manage_leads()` son `security definer` (correcto), pero su GRANT
-- EXECUTE nunca incluyó a `authenticated` — solo a `service_role`/`postgres`,
-- y 0012/0022 solo cubrieron `anon` (para que el sitio público pudiera leer
-- filas publicadas). `profiles_select` es "auth.uid() = id OR is_staff()":
-- Postgres necesita permiso de EXECUTE sobre is_staff() para poder
-- planificar esa policy aunque la primera rama del OR ya sea cierta — por
-- eso ni siquiera un usuario leyendo su propio perfil podía pasar.
--
-- Esto no es solo el login: cualquier policy de leads/destinations/articles/
-- site_content/site_settings que usa alguna de estas funciones fallaba igual
-- para el rol authenticated. Este grant es puramente aditivo — no cambia
-- ninguna policy ni lo que estas funciones devuelven, solo permite que
-- authenticated pueda invocarlas.
grant execute on function app_user_role() to authenticated;
grant execute on function is_staff() to authenticated;
grant execute on function can_manage_content() to authenticated;
grant execute on function can_manage_leads() to authenticated;
