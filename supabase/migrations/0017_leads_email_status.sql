-- submit-lead ahora envía email al admin + confirmación al cliente vía Resend.
-- El lead ya queda guardado ANTES de intentar los emails — si Resend falla,
-- el lead se conserva igual, y este estado permite detectar y seguir esos
-- casos manualmente en vez de perder silenciosamente el aviso.
alter table leads add column if not exists email_status text not null default 'pending'
  check (email_status in ('pending', 'sent', 'partial', 'failed', 'not_configured'));
alter table leads add column if not exists email_sent_at timestamptz;
alter table leads add column if not exists email_error text;
