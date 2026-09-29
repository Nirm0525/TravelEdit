-- Módulo: Smart Proposal Builder — corrige un drift de producción real.
--
-- QA de integración contra el Supabase real (no un entorno de prueba)
-- encontró que get_proposal_gate/get_proposal_content/accept_proposal
-- devolvían 401 "permission denied for function ..." (42501) al llamarlas
-- como anon, aunque 0031_proposals_public_rpc.sql ya incluye exactamente
-- estos GRANT — es decir, la base real nunca llegó a tener ese archivo
-- aplicado tal cual (mismo tipo de drift ya documentado varias veces en
-- este proyecto: 0008, 0011, 0013, 0015, 0016, 0020, 0025, 0035). Solo
-- verify_proposal_access tenía el grant, probablemente porque su reescritura
-- en 0035 (DROP + CREATE por el cambio de columnas de retorno) sí se
-- corrió a mano y esa migración vuelve a otorgar el grant explícitamente.
--
-- Verificado en vivo antes y después de este fix (REST directo con la anon
-- key real, sin pasar por Angular):
--   ANTES: get_proposal_gate/get_proposal_content/accept_proposal -> 401
--          {"code":"42501","message":"permission denied for function ..."}
--   DESPUÉS (ya aplicado en producción, este archivo solo lo documenta):
--          get_proposal_gate      -> 200 []
--          get_proposal_content   -> 400 {"code":"P0001","message":"session_invalid"}
--          accept_proposal        -> 400 {"code":"P0001","message":"session_invalid"}
--          (400/session_invalid es el comportamiento esperado de la propia
--          función ante un session_token inexistente — ya no es un error de
--          permisos, la función se ejecuta.)
--
-- Puramente aditivo: no toca RLS, no cambia la lógica de ninguna función, no
-- abre acceso directo a `proposals`/`proposal_access_sessions`/
-- `proposal_access_credentials` (siguen sin policies para anon/authenticated,
-- ver 0029/0030/0035) — solo repone los GRANT EXECUTE que ya estaban
-- especificados en 0031 pero que no llegaron a aplicarse en la base real.

begin;

grant execute
  on function public.get_proposal_gate(uuid)
  to anon, authenticated;

grant execute
  on function public.get_proposal_content(uuid, uuid)
  to anon, authenticated;

grant execute
  on function public.accept_proposal(uuid, uuid, text)
  to anon, authenticated;

-- Ya tenía el grant en producción — se incluye igual para que esta
-- migración documente el contrato completo de las 4 RPC públicas en un
-- solo lugar, no porque haga falta corregir nada aquí.
grant execute
  on function public.verify_proposal_access(uuid, text)
  to anon, authenticated;

commit;
