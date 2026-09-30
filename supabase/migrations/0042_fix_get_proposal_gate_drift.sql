-- Módulo: Smart Proposal Builder — corrige otro drift de producción real
-- (mismo patrón ya documentado varias veces: 0008, 0011, 0013, 0015, 0016,
-- 0020, 0025, 0035, 0036).
--
-- QA de integración contra el Supabase real (REST directo, anon key, sin
-- pasar por Angular) encontró que get_proposal_gate(uuid) en producción
-- devuelve ÚNICAMENTE la columna `access_required` — ni client_name, ni
-- cover_title, ni cover_image_path, ni status — aunque:
--   a) 0031_proposals_public_rpc.sql define las 5 columnas tal cual;
--   b) ninguna migración posterior la toca (0039 lo dice explícitamente:
--      "get_proposal_gate() queda intacto a propósito");
--   c) los datos en `proposals` para la fila probada eran correctos
--      (client_name, title y cover_image_path con valor real).
-- Conclusión: la base real nunca llegó a tener la versión de 0031 aplicada
-- tal cual — quedó una versión anterior/parcial de la función. Resultado
-- visible para el usuario: la pantalla de acceso privado nunca mostraba el
-- nombre del cliente, el título del viaje ni la foto de portada, sin
-- importar qué se hubiera cargado en el admin.
--
-- DROP + CREATE porque un cambio de forma de RETURNS TABLE no se resuelve
-- con CREATE OR REPLACE (mismo motivo documentado en 0035/0039).
drop function if exists get_proposal_gate(uuid);

create function get_proposal_gate(p_token uuid)
returns table (
  access_required   boolean,
  client_name       text,
  cover_title       text,
  cover_image_path  text,
  status            text
)
language sql stable security definer set search_path = public as $$
  select p.access_required, p.client_name, p.title, p.cover_image_path, p.status
  from proposals p
  where p.public_token = p_token
    and p.status in ('published', 'viewed', 'accepted')
    and (p.expires_at is null or p.expires_at > now())
$$;

-- El DROP + CREATE anterior resetea los grants — repuesto explícitamente,
-- mismo valor que 0036 ya documentaba para esta función.
grant execute
  on function public.get_proposal_gate(uuid)
  to anon, authenticated;
