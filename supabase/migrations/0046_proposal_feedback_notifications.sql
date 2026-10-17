-- Módulo: Smart Proposal Builder — avisos al equipo cuando el cliente envía
-- sus comentarios o acepta la propuesta (función notify-proposal-activity).
--
-- feedback_sent_at: última vez que el cliente pulsó "Enviar comentarios a mi
-- asesora". Sirve para mostrar el aviso "Cambios solicitados" en el panel y
-- para no mandar dos correos seguidos.
-- accepted_notified_at: evita avisar dos veces de la misma aceptación.
--
-- Solo la service role (edge function) escribe estas columnas; el cliente
-- público nunca las toca.
alter table proposals
  add column if not exists feedback_sent_at timestamptz,
  add column if not exists accepted_notified_at timestamptz;

revoke update (feedback_sent_at, accepted_notified_at) on proposals from anon, authenticated;
