-- Módulo: Smart Proposal Builder — correo del cliente en la propia propuesta.
--
-- Hasta ahora "Enviar al cliente" solo funcionaba si la propuesta venía de una
-- solicitud (lead) con correo: send-proposal leía el destinatario de
-- leads.email y rechazaba cualquier propuesta sin lead vinculado. Una
-- propuesta creada a mano ("Nueva propuesta") no tenía a quién enviarse.
--
-- proposals.client_email lo carga el staff en el paso "Cliente y viaje" (RLS de
-- staff, igual que el resto de las columnas). La Edge Function sigue sin
-- aceptar un destinatario en el body de la request: lee este valor del row con
-- la service role, así que nadie puede mandar la propuesta a un correo
-- arbitrario manipulando la petición.
alter table proposals
  add column if not exists client_email text;

-- Formato básico — no pretende validar que el buzón exista.
alter table proposals
  drop constraint if exists proposals_client_email_format;

alter table proposals
  add constraint proposals_client_email_format
  check (client_email is null or client_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');
