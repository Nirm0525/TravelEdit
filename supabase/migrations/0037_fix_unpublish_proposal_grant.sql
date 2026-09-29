-- Módulo: Smart Proposal Builder — corrige otro drift de permisos real.
--
-- QA de integración (re-test del flujo de despublicar) encontró que
-- unpublish_proposal() devolvía 403 "permission denied for function
-- unpublish_proposal" (42501) para el rol authenticated, aunque
-- 0032_proposals_admin_rpc.sql ya incluye ese GRANT — mismo tipo de drift
-- que 0036 (publish_proposal/set_proposal_access_code sí tenían el grant;
-- solo unpublish_proposal se perdió).
--
-- Verificado en vivo antes y después (UI real, cuenta de staff real):
--   ANTES: click en "Despublicar" -> 403 42501 permission denied
--   DESPUÉS (ya aplicado en producción, este archivo solo lo documenta):
--          click en "Despublicar" -> 200, status published/viewed -> draft,
--          published_at -> null, sesiones públicas revocadas — todo
--          confirmado contra Supabase real.
--
-- Puramente aditivo: no toca RLS, no cambia la lógica de ninguna función.
--
-- NOTA aparte (no corregida en este archivo, solo documentada): el mismo
-- QA encontró que la función unpublish_proposal() que corre en producción
-- ya NO es idéntica al cuerpo que describe 0032_proposals_admin_rpc.sql —
-- la versión real rechaza despublicar una propuesta 'accepted' (mensaje de
-- error real: "La propuesta no está publicada o ya fue aceptada"), mientras
-- que 0032 todavía permite 'accepted' en su lista de status. Es un drift
-- adicional, en la dirección correcta (la base real es más estricta, no al
-- revés), pero significa que 0032 ya no describe el comportamiento real.
-- Pendiente de una migración futura que documente el cuerpo real de la
-- función una vez confirmado, mismo criterio que 0035.

begin;

grant execute
on function public.unpublish_proposal(uuid)
to authenticated;

commit;
