export type SiteStatus = 'active' | 'maintenance';

// Todas las claves conocidas de site_settings, con su tipo real. Ninguna
// almacena secretos — RESEND_API_KEY y TURNSTILE_SECRET_KEY viven solo en
// Supabase Edge Function Secrets (ver supabase/migrations/0019_site_settings.sql).
export interface SiteSettingsMap {
  site_name: string;
  company_name: string;
  public_site_url: string;
  timezone: string;
  language: string;
  site_status: SiteStatus;
  contact_email: string;
  contact_phone: string;
  contact_whatsapp: string;
  contact_address: string;
  contact_hours: string;
  leads_admin_email: string;
  resend_from_email: string;
  email_notifications_enabled: boolean;
  customer_confirmation_enabled: boolean;
  leads_phone_required: boolean;
  leads_allow_no_destination: boolean;
  appearance_accent_color: string;
  appearance_logo_url: string;
  appearance_favicon_url: string;
}

export type SiteSettingKey = keyof SiteSettingsMap;

// Respuesta de la Edge Function settings-status — nunca incluye el valor de
// ningún secret, solo si está configurado o no (ver 0. Seguridad).
export interface IntegrationStatus {
  resendConfigured: boolean;
  turnstileSecretConfigured: boolean;
}

// Mismos valores sembrados por la migración 0019 — sirven como fallback en
// memoria si una fila todavía no existe en la base (nunca se muestra un
// campo vacío/undefined sin explicación).
export const SITE_SETTINGS_DEFAULTS: SiteSettingsMap = {
  site_name: 'Travel Edit',
  company_name: 'Travel International',
  public_site_url: 'https://thetravel-edit.com',
  timezone: 'America/Tegucigalpa',
  language: 'es',
  site_status: 'active',
  contact_email: '',
  contact_phone: '',
  contact_whatsapp: '',
  contact_address: '',
  contact_hours: '',
  leads_admin_email: 'marcela@travelinternational.org',
  resend_from_email: 'The Travel Edit <onboarding@resend.dev>',
  email_notifications_enabled: true,
  customer_confirmation_enabled: true,
  leads_phone_required: true,
  leads_allow_no_destination: true,
  appearance_accent_color: '#7A2338',
  appearance_logo_url: 'images/logos/thetraveledit2.png',
  appearance_favicon_url: 'favicon.ico'
};
