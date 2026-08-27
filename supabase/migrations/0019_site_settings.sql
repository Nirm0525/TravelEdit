-- Módulo: configuración general del sitio (panel admin > Configuración).
-- Aditiva: no toca tablas, columnas ni políticas existentes.
-- No almacena secretos: RESEND_API_KEY y TURNSTILE_SECRET_KEY siguen
-- viviendo únicamente en Supabase Edge Function Secrets, nunca aquí.

create table site_settings (
  id           uuid primary key default gen_random_uuid(),
  key          text unique not null,
  value        jsonb not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references profiles(id)
);

alter table site_settings enable row level security;

-- Configuración es información sensible del negocio (emails, estado del
-- sitio, etc.) — a diferencia de leads, aquí no se abre a "staff": solo admin.
create policy site_settings_select on site_settings for select using (app_user_role() = 'admin');
create policy site_settings_insert on site_settings for insert with check (app_user_role() = 'admin');
create policy site_settings_update on site_settings for update using (app_user_role() = 'admin');
create policy site_settings_delete on site_settings for delete using (app_user_role() = 'admin');

-- El actor y el timestamp los fija siempre el trigger, nunca lo que mande el
-- cliente — mismo criterio que trg_log_lead_deleted (0018): un valor que
-- llega del navegador no es una fuente confiable de "quién hizo esto".
create function set_site_setting_audit_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger trg_site_settings_audit_fields
  before insert or update on site_settings
  for each row
  execute function set_site_setting_audit_fields();

-- Reutiliza audit_log (0006) — nunca registra el valor nuevo/anterior, solo
-- qué clave cambió, para que agregar a futuro una clave sensible por error
-- nunca termine filtrando su valor al log de auditoría.
create function log_site_setting_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (
    auth.uid(),
    'site_setting_updated',
    'site_setting',
    new.key,
    'Actualizó la configuración "' || new.key || '"'
  );
  return new;
end;
$$;

create trigger trg_log_site_setting_change
  after insert or update on site_settings
  for each row
  execute function log_site_setting_change();

create index idx_site_settings_key on site_settings (key);

-- Semilla: los mismos valores actualmente hardcodeados como fallback en
-- supabase/functions/submit-lead/index.ts, para que activar este módulo no
-- cambie ningún comportamiento en producción hasta que un admin los edite
-- a propósito desde el panel.
insert into site_settings (key, value, description) values
  ('site_name', '"Travel Edit"', 'Nombre del sitio mostrado en el panel y comunicaciones.'),
  ('company_name', '"Travel International"', 'Razón social de la empresa.'),
  ('public_site_url', '"https://thetravel-edit.com"', 'URL pública del sitio.'),
  ('timezone', '"America/Tegucigalpa"', 'Zona horaria usada para fechas administrativas.'),
  ('language', '"es"', 'Idioma principal del sitio.'),
  ('site_status', '"active"', 'Estado operativo del sitio: active o maintenance.'),
  ('contact_email', '""', 'Email principal de contacto de la empresa.'),
  ('contact_phone', '""', 'Teléfono de contacto.'),
  ('contact_whatsapp', '""', 'Número de WhatsApp de contacto.'),
  ('contact_address', '""', 'Dirección física.'),
  ('contact_hours', '""', 'Horario de atención.'),
  ('leads_admin_email', '"marcela@travelinternational.org"',
    'Correo que recibe la notificación de nuevas solicitudes. submit-lead lo usa como override de LEADS_ADMIN_EMAIL cuando está definido.'),
  ('resend_from_email', '"The Travel Edit <onboarding@resend.dev>"',
    'Remitente usado al enviar correos vía Resend. submit-lead lo usa como override de RESEND_FROM_EMAIL cuando está definido.'),
  ('email_notifications_enabled', 'true',
    'Si está activo, submit-lead envía el correo de notificación al administrador.'),
  ('customer_confirmation_enabled', 'true',
    'Si está activo, submit-lead envía el correo de confirmación al cliente.'),
  ('leads_phone_required', 'true',
    'Informativo: refleja si el teléfono es obligatorio en el formulario público. Todavía no está conectado a la validación de submit-lead ni del wizard.'),
  ('leads_allow_no_destination', 'true',
    'Informativo: refleja si se permiten solicitudes sin destino. Todavía no está conectado a ninguna validación.'),
  ('appearance_accent_color', '"#7A2338"',
    'Color de acento de la marca. Se guarda, pero todavía no se aplica dinámicamente al sitio público.'),
  ('appearance_logo_url', '"images/logos/thetraveledit2.png"',
    'Ruta del logo actual. Se guarda, pero todavía no se aplica dinámicamente.'),
  ('appearance_favicon_url', '"favicon.ico"',
    'Ruta del favicon actual. Se guarda, pero todavía no se aplica dinámicamente.')
on conflict (key) do nothing;
