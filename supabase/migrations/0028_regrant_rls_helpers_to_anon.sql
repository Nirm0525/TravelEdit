-- Bug real confirmado en vivo: el sitio público (rol anon) recibía 401 al
-- pedir `articles` — la policy articles_select es
-- "(status='published' AND ...) OR is_staff()", y Postgres necesita EXECUTE
-- sobre is_staff() para poder planificar esa policy aunque la rama OR nunca
-- se cumpla para anon (mismo mecanismo ya documentado en 0012 y 0022/0023).
--
-- Se confirmó consultando information_schema.routine_privileges contra la
-- base real: is_staff()/can_manage_content() NO tenían a `anon` en la lista
-- de grantees, pese a que 0012_grant_anon_execute_role_functions.sql ya
-- otorgaba exactamente este grant — quedó revertido o nunca se aplicó tal
-- cual a esta base. Este archivo vuelve a aplicarlo; es puramente aditivo y
-- ya se verificó en vivo (select sobre articles como anon, antes fallaba
-- con 42501/401, ahora funciona).
grant execute on function is_staff() to anon;
grant execute on function can_manage_content() to anon;
