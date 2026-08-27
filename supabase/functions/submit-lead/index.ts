// Edge Function: submit-lead
//
// El formulario público llama aquí, nunca inserta directo en `leads` — no
// hay política de INSERT anónimo (ver 0003_leads.sql). Esta función valida
// el captcha, aplica un rate-limit por IP y hace el insert ella misma con
// la service role, fijando status/assigned_to — el cliente no controla eso
// aunque lo intente, porque esos valores no vienen del body de la request.
import { createClient } from 'npm:@supabase/supabase-js@2';

const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_ATTEMPTS = 5;

// Mismo patrón que admin-users: el navegador manda un preflight OPTIONS
// antes del POST, y ese preflight debe responderse con el origen exacto
// que llama — nada de "*".
const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const requestOrigin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (ALLOWED_ORIGINS.has(requestOrigin)) {
    headers['Access-Control-Allow-Origin'] = requestOrigin;
  }
  return headers;
}

// El header Origin/CORS solo lo respeta un navegador — un POST directo
// (curl, script) lo ignora por completo y de todos modos llegaría hasta el
// insert. `hostname` en la respuesta de siteverify es el dominio donde
// Cloudflare realmente vio resolverse el widget, así que es la señal server-
// side confiable: mismos dominios que ya confiamos para CORS.
const ALLOWED_HOSTNAMES = new Set(Array.from(ALLOWED_ORIGINS, (o) => new URL(o).hostname));

// Los tres secrets de prueba documentados por Cloudflare (siempre aprueban /
// siempre bloquean / fuerza challenge) devuelven siempre hostname:
// "example.com" en siteverify, sin importar la página real — no dan
// protección real, así que mientras se use uno de estos no tiene sentido
// exigir que el hostname cuadre. En cuanto TURNSTILE_SECRET_KEY sea un
// secret real de Cloudflare, esta lista deja de aplicar y el check de abajo
// se vuelve estricto.
const CLOUDFLARE_TEST_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA'
]);

const ORIGIN_VALUES = ['formulario_web', 'whatsapp', 'instagram', 'referido', 'email', 'otro'] as const;
type Origin = (typeof ORIGIN_VALUES)[number];

interface LeadTripDetails {
  location?: string;
  travelingWith?: string;
  adults?: number;
  children?: number;
  childrenAges?: string;
  destinationNotes?: string;
  departureDate?: string;
  returnDate?: string;
  nights?: number;
  datesFlexible?: boolean;
  occasion?: string;
  stylePreferences?: string[];
  pace?: string;
  hotelStyle?: string;
  budgetRange?: string;
  flightClass?: string;
  likesAndDislikes?: string;
  unforgettableNote?: string;
  hearAboutUs?: string;
}

interface LeadRequestBody {
  name?: string;
  email?: string;
  phone?: string;
  destinationInterestText?: string;
  details?: LeadTripDetails;
  turnstileToken?: string;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function hashIp(ip: string): Promise<string> {
  const data = new TextEncoder().encode(ip);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// Fallbacks — se usan solo si el secret correspondiente no está configurado
// en Supabase, para no romper el envío existente. LEADS_ADMIN_EMAIL y
// RESEND_FROM_EMAIL los sobreescribe una vez estén cargados como secrets.
const FALLBACK_ADMIN_EMAIL = 'marcela@travelinternational.org';
// onboarding@resend.dev es el remitente de pruebas de Resend: funciona sin
// verificar ningún dominio propio, pero no es apto para producción real —
// una vez thetravel-edit.com esté verificado en Resend, RESEND_FROM_EMAIL
// debe apuntar a un remitente de ese dominio.
const FALLBACK_FROM_EMAIL = 'The Travel Edit <onboarding@resend.dev>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

function formatDetailsRows(details: LeadTripDetails): Array<[string, string]> {
  const travelers = [
    details.adults != null ? `${details.adults} adulto(s)` : null,
    details.children != null && details.children > 0
      ? `${details.children} niño(s)${details.childrenAges ? ` (${details.childrenAges})` : ''}`
      : null
  ]
    .filter(Boolean)
    .join(', ');

  const dates = [
    details.departureDate ? `Salida: ${details.departureDate}` : null,
    details.returnDate ? `Regreso/duración: ${details.returnDate}` : null,
    details.datesFlexible ? 'Fechas flexibles' : null
  ]
    .filter(Boolean)
    .join(' — ');

  const rows: Array<[string, string | undefined]> = [
    ['Dónde está basado', details.location],
    ['Viaja con', details.travelingWith],
    ['Viajeros', travelers || undefined],
    ['Fechas', dates || undefined],
    ['Notas sobre el destino', details.destinationNotes],
    ['Ocasión', details.occasion],
    ['Preferencias de estilo', details.stylePreferences?.length ? details.stylePreferences.join(', ') : undefined],
    ['Ritmo del viaje', details.pace],
    ['Estilo de hotel', details.hotelStyle],
    ['Presupuesto (porción terrestre)', details.budgetRange],
    ['Clase de vuelo', details.flightClass],
    ['Gustos / a evitar', details.likesAndDislikes],
    ['Qué haría el viaje inolvidable', details.unforgettableNote],
    ['Cómo nos conoció', details.hearAboutUs]
  ];

  return rows.filter((row): row is [string, string] => !!row[1]);
}

function buildAdminEmail(
  name: string,
  email: string,
  phone: string,
  destinationInterestText: string | null,
  details: LeadTripDetails
): EmailContent {
  const rows: Array<[string, string]> = [
    ['Nombre', name],
    ['Correo', email],
    ['Teléfono', phone],
    ...(destinationInterestText ? ([['Destino de interés', destinationInterestText]] as Array<[string, string]>) : []),
    ...formatDetailsRows(details)
  ];

  const html = `
    <h2>Nueva solicitud de viaje — Design Your Trip</h2>
    <table cellpadding="6" cellspacing="0" border="0">
      ${rows
        .map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`)
        .join('')}
    </table>
    <p>Responde directamente a este correo para escribirle al cliente.</p>
  `;
  const text = rows.map(([label, value]) => `${label}: ${value}`).join('\n');

  return { subject: 'Nueva solicitud de viaje — Design Your Trip', html, text };
}

function buildCustomerEmail(name: string): EmailContent {
  const safeName = escapeHtml(name);
  const html = `
    <p>Hola ${safeName},</p>
    <p>Hemos recibido correctamente tu solicitud de viaje.</p>
    <p>Nuestro equipo revisará la información y se pondrá en contacto contigo para ayudarte a planificar tu experiencia.</p>
    <p>Gracias por confiar en Travel Edit.</p>
    <p>Travel Edit</p>
  `;
  const text = [
    `Hola ${name},`,
    '',
    'Hemos recibido correctamente tu solicitud de viaje.',
    '',
    'Nuestro equipo revisará la información y se pondrá en contacto contigo para ayudarte a planificar tu experiencia.',
    '',
    'Gracias por confiar en Travel Edit.',
    '',
    'Travel Edit'
  ].join('\n');

  return { subject: 'Recibimos tu solicitud de viaje — Travel Edit', html, text };
}

interface EmailResult {
  sent: boolean;
  error?: string;
}

/** Nunca debe tumbar la solicitud — el lead ya está guardado, que es la
 *  fuente de verdad. Un fallo aquí solo se refleja en email_status. */
async function sendViaResend(
  apiKey: string,
  fromEmail: string,
  payload: { to: string[]; subject: string; html: string; text: string; replyTo?: string }
): Promise<EmailResult> {
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: fromEmail,
        to: payload.to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        ...(payload.replyTo ? { reply_to: payload.replyTo } : {})
      })
    });

    if (!response.ok) {
      console.error('sendViaResend: Resend respondió', response.status, await response.text());
      return { sent: false, error: `Resend respondió ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('sendViaResend: error inesperado enviando email', err);
    return { sent: false, error: 'error de red hacia Resend' };
  }
}

/** Nunca confiar en que el frontend diga "Turnstile aprobado" — esta es la
 *  única verificación que cuenta, y ocurre server-side contra Cloudflare.
 *  Cualquier fallo (red, Cloudflare caído, secret ausente, hostname que no
 *  cuadra) debe resolver a "no válido" sin tumbar la función ni filtrar
 *  detalles técnicos al cliente — por eso todo el ruido queda en
 *  console.error para los logs de la función, y el caller solo recibe true/false. */
async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    console.error('verifyTurnstile: falta TURNSTILE_SECRET_KEY en los secrets de la función.');
    return false;
  }

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: remoteIp })
    });

    if (!response.ok) {
      console.error('verifyTurnstile: Cloudflare respondió', response.status, await response.text());
      return false;
    }

    const result = (await response.json()) as {
      success: boolean;
      hostname?: string;
      'error-codes'?: string[];
    };

    if (!result.success) {
      console.error('verifyTurnstile: token rechazado por Cloudflare', result['error-codes']);
      return false;
    }

    // Cloudflare solo manda `hostname` cuando puede determinarlo — si viene,
    // debe ser uno de los dominios en los que confiamos. Excepción: los
    // secrets de prueba de Cloudflare siempre devuelven "example.com" sin
    // relación con la página real, así que no aplican este check.
    if (result.hostname && !CLOUDFLARE_TEST_SECRETS.has(secret) && !ALLOWED_HOSTNAMES.has(result.hostname)) {
      console.error('verifyTurnstile: hostname inesperado en la respuesta', result.hostname);
      return false;
    }

    return true;
  } catch (err) {
    console.error('verifyTurnstile: error inesperado verificando contra Cloudflare', err);
    return false;
  }
}

interface OperationalSettings {
  resendFromEmail: string | null;
  leadsAdminEmail: string | null;
  emailNotificationsEnabled: boolean;
  customerConfirmationEnabled: boolean;
}

// Lee únicamente valores NO sensibles de site_settings (panel admin >
// Configuración > Leads/Correos) como override opcional de los secrets.
// RESEND_API_KEY jamás se lee de aquí — sigue viniendo solo de
// Deno.env.get. Cualquier fallo (tabla no existe todavía, red, etc.) cae en
// los mismos valores que el comportamiento actual, para no romper el envío
// de leads por un problema en una función que es puramente cosmética.
// deno-lint-ignore no-explicit-any
async function fetchOperationalSettings(serviceClient: any): Promise<OperationalSettings> {
  const defaults: OperationalSettings = {
    resendFromEmail: null,
    leadsAdminEmail: null,
    emailNotificationsEnabled: true,
    customerConfirmationEnabled: true
  };

  try {
    const { data, error } = await serviceClient
      .from('site_settings')
      .select('key, value')
      .in('key', ['resend_from_email', 'leads_admin_email', 'email_notifications_enabled', 'customer_confirmation_enabled']);

    if (error || !data) {
      return defaults;
    }

    const values = new Map<string, unknown>(data.map((row: { key: string; value: unknown }) => [row.key, row.value]));
    const resendFromEmail = values.get('resend_from_email');
    const leadsAdminEmail = values.get('leads_admin_email');

    return {
      resendFromEmail: typeof resendFromEmail === 'string' && resendFromEmail ? resendFromEmail : null,
      leadsAdminEmail: typeof leadsAdminEmail === 'string' && leadsAdminEmail ? leadsAdminEmail : null,
      emailNotificationsEnabled: values.get('email_notifications_enabled') !== false,
      customerConfirmationEnabled: values.get('customer_confirmation_enabled') !== false
    };
  } catch (err) {
    console.error('submit-lead: no se pudo leer site_settings, se usan los valores por defecto.', err);
    return defaults;
  }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  // Cualquier fallo no anticipado de aquí en adelante (JSON mal formado,
  // Supabase caído, etc.) cae aquí — el cliente nunca debe ver un stack
  // trace ni un mensaje técnico, solo un mensaje genérico. El detalle real
  // queda en console.error, visible en los logs de la función.
  try {
    const body = (await req.json()) as LeadRequestBody;
    const name = body.name?.trim() ?? '';
    const email = body.email?.trim() ?? '';
    const phone = body.phone?.trim() ?? '';

    if (!name || !isValidEmail(email) || !phone) {
      return json({ error: 'Nombre, correo válido y teléfono son obligatorios.' }, 400);
    }
    console.log('Lead received');

    if (!body.turnstileToken) {
      return json({ error: 'Falta la verificación anti-spam.' }, 400);
    }

    const remoteIp = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const ipHash = await hashIp(remoteIp);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MINUTES * 60_000).toISOString();
    const { count } = await serviceClient
      .from('lead_submission_attempts')
      .select('id', { count: 'exact', head: true })
      .eq('ip_hash', ipHash)
      .gte('created_at', windowStart);

    await serviceClient.from('lead_submission_attempts').insert({ ip_hash: ipHash });

    if ((count ?? 0) >= RATE_LIMIT_MAX_ATTEMPTS) {
      return json({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }, 429);
    }

    // Única verificación que cuenta: server-side, contra Cloudflare. El
    // lead no se inserta si esto no devuelve true, sin excepciones.
    const captchaOk = await verifyTurnstile(body.turnstileToken, remoteIp);
    if (!captchaOk) {
      return json({ error: 'No se pudo verificar que eres una persona.' }, 400);
    }
    console.log('Turnstile validated');

    const destinationInterestText = body.destinationInterestText?.trim() || null;
    const details = body.details ?? {};

    const origin: Origin = 'formulario_web';
    const { data: insertedLead, error } = await serviceClient
      .from('leads')
      .insert({
        name,
        email,
        phone,
        destination_interest_text: destinationInterestText,
        details,
        origin
      })
      .select('id')
      .single();

    if (error || !insertedLead) {
      console.error('submit-lead: insert en leads falló', error);
      return json({ error: 'No se pudo enviar la solicitud.' }, 500);
    }
    console.log('Lead inserted', insertedLead.id);

    // El lead YA está guardado en este punto — es la fuente de verdad. Todo
    // lo que sigue es best-effort: si Resend falla, el lead se conserva
    // igual, y solo queda registrado en email_status para dar seguimiento
    // manual después. Nunca debe perderse una solicitud por un problema
    // temporal del proveedor de correo.
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    let emailStatus: 'not_configured' | 'sent' | 'partial' | 'failed' = 'not_configured';
    let emailSentAt: string | null = null;
    let emailError: string | null = null;

    if (!resendApiKey) {
      console.error('submit-lead: RESEND_API_KEY no configurado — el lead quedó guardado, no se envían emails.');
    } else {
      const opSettings = await fetchOperationalSettings(serviceClient);
      const fromEmail = opSettings.resendFromEmail || Deno.env.get('RESEND_FROM_EMAIL') || FALLBACK_FROM_EMAIL;
      const adminEmail = opSettings.leadsAdminEmail || Deno.env.get('LEADS_ADMIN_EMAIL') || FALLBACK_ADMIN_EMAIL;

      // 'skipped' = el admin apagó esa notificación desde Configuración > Leads,
      // no cuenta como intento fallido para el cálculo de emailStatus de abajo.
      type SendOutcome = 'sent' | 'failed' | 'skipped';
      let adminOutcome: SendOutcome = 'skipped';
      let customerOutcome: SendOutcome = 'skipped';
      let adminErrorMsg: string | undefined;
      let customerErrorMsg: string | undefined;

      if (opSettings.emailNotificationsEnabled) {
        const admin = buildAdminEmail(name, email, phone, destinationInterestText, details);
        // reply_to = el correo ya validado del cliente, nunca uno arbitrario
        // que venga de otro campo del body — así "Responder" en el correo del
        // admin va directo al cliente sin que el cliente controle el `from`.
        const adminResult = await sendViaResend(resendApiKey, fromEmail, {
          to: [adminEmail],
          subject: admin.subject,
          html: admin.html,
          text: admin.text,
          replyTo: email
        });
        adminOutcome = adminResult.sent ? 'sent' : 'failed';
        adminErrorMsg = adminResult.error;
        console.log(adminResult.sent ? 'Admin email sent' : 'Admin email failed');
      } else {
        console.log('Admin email skipped (email_notifications_enabled = false)');
      }

      if (opSettings.customerConfirmationEnabled) {
        const customer = buildCustomerEmail(name);
        const customerResult = await sendViaResend(resendApiKey, fromEmail, {
          to: [email],
          subject: customer.subject,
          html: customer.html,
          text: customer.text
        });
        customerOutcome = customerResult.sent ? 'sent' : 'failed';
        customerErrorMsg = customerResult.error;
        console.log(customerResult.sent ? 'Customer email sent' : 'Customer email failed');
      } else {
        console.log('Customer email skipped (customer_confirmation_enabled = false)');
      }

      const attempted = [adminOutcome, customerOutcome].filter((outcome): outcome is 'sent' | 'failed' => outcome !== 'skipped');

      if (attempted.length === 0) {
        // Ambas notificaciones apagadas a propósito desde Configuración — no
        // se intentó ningún envío, mismo estado que "sin proveedor" porque
        // ninguno de los dos describe mejor "nadie lo intentó".
        emailStatus = 'not_configured';
      } else {
        const sentCount = attempted.filter((outcome) => outcome === 'sent').length;
        emailStatus = sentCount === attempted.length ? 'sent' : sentCount > 0 ? 'partial' : 'failed';
        emailSentAt = sentCount > 0 ? new Date().toISOString() : null;
      }

      const errors = [
        adminErrorMsg ? `admin: ${adminErrorMsg}` : null,
        customerErrorMsg ? `cliente: ${customerErrorMsg}` : null
      ].filter((e): e is string => !!e);
      emailError = errors.length ? errors.join(' | ') : null;
    }

    try {
      await serviceClient
        .from('leads')
        .update({ email_status: emailStatus, email_sent_at: emailSentAt, email_error: emailError })
        .eq('id', insertedLead.id);
    } catch (err) {
      console.error('submit-lead: no se pudo actualizar email_status', err);
    }

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('submit-lead: error inesperado', err);
    return json({ error: 'No pudimos procesar tu solicitud. Inténtalo nuevamente.' }, 500);
  }
});
