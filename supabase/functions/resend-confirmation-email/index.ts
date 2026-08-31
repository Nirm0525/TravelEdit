// Edge Function: resend-confirmation-email
//
// El botón "Reintentar envío" del detalle de solicitud llama aquí. Reenvía
// exactamente el mismo correo de "recibimos tu solicitud" que submit-lead le
// manda al cliente al crear el lead — para un lead cuyo email_status quedó
// en 'failed'/'not_configured'/'partial', o simplemente para reenviarlo a
// pedido del staff. Requiere sesión (verify_jwt=true por defecto, sin
// entrada en config.toml — mismo patrón que send-proposal/admin-users).
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FALLBACK_FROM_EMAIL = 'The Travel Edit <onboarding@resend.dev>';
const SITE = 'https://thetravel-edit.com';
const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

function formatFechaCorta(date: Date): string {
  return `${date.getDate()} ${MESES_CORTOS[date.getMonth()]} ${date.getFullYear()}`;
}

// Mismo header/footer/shell de marca que submit-lead y send-proposal.
function emailHeaderHtml(): string {
  return `
    <tr>
      <td align="center" style="padding:8px 24px 24px;">
        <img src="${SITE}/images/logos/thetraveleditlogo1.png" width="140" alt="The Travel Edit" style="display:block; margin:0 auto 12px;" />
        <div style="border-top:1px solid #C79A5B; width:100%; margin:0 0 12px;"></div>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; letter-spacing:3px; color:#8A7F76;">BECAUSE LUXURY IS PERSONAL</p>
        <div style="border-top:1px solid #C79A5B; width:100%; margin:12px 0 0;"></div>
      </td>
    </tr>`;
}

function emailFooterHtml(legalLine: string): string {
  return `
    <tr>
      <td style="background:#CAAE97; padding:24px 32px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="middle">
              <img src="${SITE}/images/logos/thetraveledit2.png" width="90" alt="The Travel Edit" style="display:block;" />
            </td>
            <td valign="middle" align="right" style="font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#16110F; line-height:1.6;">
              info@thetravel-edit.com<br />www.thetravel-edit.com
            </td>
          </tr>
        </table>
      </td>
    </tr>

    <tr>
      <td style="background:#4A1F26; padding:16px 32px;">
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.6; color:#CAAE97;">${legalLine}</p>
      </td>
    </tr>`;
}

function emailShellHtml(bodyRowsHtml: string, legalLine: string): string {
  return `
<!doctype html>
<html>
  <body style="margin:0; padding:0; background:#F6EFE6;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F6EFE6;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%; background:#F6EFE6;">
            ${emailHeaderHtml()}
            ${bodyRowsHtml}
            ${emailFooterHtml(legalLine)}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

// Idéntico a buildCustomerEmail() de submit-lead — el cliente debe recibir
// exactamente el mismo correo, solo que reenviado.
function buildCustomerEmail(name: string): { subject: string; html: string; text: string } {
  const safeName = escapeHtml(name);
  const fecha = formatFechaCorta(new Date());

  const bodyRows = `
    <tr>
      <td style="background:#6D2A34; padding:32px 32px 36px; border-radius:2px;">
        <p style="margin:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; letter-spacing:2px; color:#CAAE97;">SOLICITUD RECIBIDA &middot; ${fecha}</p>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:30px; line-height:1.25; color:#F6EFE6;">Hola ${safeName},<br />ya estamos en ello.</p>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 32px 8px;">
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.6; color:#16110F;">Nuestro equipo ya está revisando la información que nos compartiste para empezar a diseñar tu experiencia.</p>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 4px;">
        <p style="margin:0 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; letter-spacing:2px; color:#8A7F76;">QUÉ SIGUE</p>
        <div style="border-top:1px solid #C79A5B;"></div>
      </td>
    </tr>

    ${[
      ['01', 'REVISIÓN', 'Estudiamos tu solicitud, destinos y fechas propuestas.'],
      ['02', 'CONTACTO', 'Un asesor te escribe en menos de 24 horas hábiles.'],
      ['03', 'PROPUESTA', 'Recibes un itinerario hecho enteramente a tu medida.']
    ]
      .map(
        ([n, label, desc]) => `
    <tr>
      <td style="padding:16px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td valign="top" style="padding-right:16px; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:22px; color:#CAAE97; width:36px;">${n}</td>
            <td valign="top">
              <p style="margin:0 0 4px; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; letter-spacing:1px; color:#7A2338;">${label}</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5; color:#16110F;">${desc}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
      )
      .join('')}

    <tr>
      <td style="padding:24px 32px 8px;">
        <a href="${SITE}" style="display:inline-block; background:#6D2A34; color:#F6EFE6; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; letter-spacing:2px; padding:14px 28px;">EXPLORA TRAVEL EDIT</a>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 32px;">
        <div style="border-top:1px solid #C79A5B; margin:0 0 20px;"></div>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:17px; color:#6D2A34;">Gracias por confiar en nosotros.</p>
      </td>
    </tr>`;

  const html = emailShellHtml(bodyRows, 'Recibes este correo porque solicitaste información de viaje en The Travel Edit.');
  const text = [
    `Hola ${name}, ya estamos en ello.`,
    '',
    'Nuestro equipo ya está revisando la información que nos compartiste para empezar a diseñar tu experiencia.',
    '',
    'Qué sigue:',
    '01 Revisión — Estudiamos tu solicitud, destinos y fechas propuestas.',
    '02 Contacto — Un asesor te escribe en menos de 24 horas hábiles.',
    '03 Propuesta — Recibes un itinerario hecho enteramente a tu medida.',
    '',
    `Explora Travel Edit: ${SITE}`,
    '',
    'Gracias por confiar en nosotros.',
    '',
    'The Travel Edit'
  ].join('\n');

  return { subject: 'Recibimos tu solicitud de viaje — The Travel Edit', html, text };
}

interface SendResult {
  sent: boolean;
  error?: string;
}

async function sendViaResend(
  apiKey: string,
  fromEmail: string,
  payload: { to: string[]; subject: string; html: string; text: string }
): Promise<SendResult> {
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
        text: payload.text
      })
    });

    if (!response.ok) {
      console.error('resend-confirmation-email: Resend respondió', response.status, await response.text());
      return { sent: false, error: `Resend respondió ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('resend-confirmation-email: error inesperado enviando email', err);
    return { sent: false, error: 'error de red hacia Resend' };
  }
}

// deno-lint-ignore no-explicit-any
async function fetchResendFromEmail(serviceClient: any): Promise<string> {
  try {
    const { data } = await serviceClient.from('site_settings').select('value').eq('key', 'resend_from_email').maybeSingle();
    const override = data?.value;
    if (typeof override === 'string' && override) {
      return override;
    }
  } catch (err) {
    console.error('resend-confirmation-email: no se pudo leer resend_from_email de site_settings, se usa el fallback.', err);
  }
  return Deno.env.get('RESEND_FROM_EMAIL') || FALLBACK_FROM_EMAIL;
}

interface RequestBody {
  leadId?: string;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ code: 'METHOD_NOT_ALLOWED', error: 'Método no permitido.' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', error: 'Falta el header de autorización.' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', error: 'Token de autorización inválido.' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', error: 'Sesión inválida.' }, 401);
  }

  // Mecanismo de permisos existente: can_manage_leads() = admin/staff/editor.
  const { data: canManage, error: canManageError } = await callerClient.rpc('can_manage_leads');
  if (canManageError || canManage !== true) {
    return json({ code: 'FORBIDDEN', error: 'No tienes permiso para reenviar este correo.' }, 403);
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : '';
  if (!leadId) {
    return json({ code: 'BAD_REQUEST', error: 'Falta la solicitud a la que reenviar el correo.' }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: lead, error: leadError } = await serviceClient
    .from('leads')
    .select('id, name, email')
    .eq('id', leadId)
    .maybeSingle();

  if (leadError) {
    console.error('resend-confirmation-email: error leyendo el lead', leadError);
    return json({ code: 'INTERNAL_ERROR', error: 'No se pudo cargar la solicitud.' }, 500);
  }
  if (!lead) {
    return json({ code: 'NOT_FOUND', error: 'La solicitud no existe.' }, 404);
  }
  if (!lead.email) {
    return json({ code: 'BAD_REQUEST', error: 'Esta solicitud no tiene un correo válido.' }, 400);
  }

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('resend-confirmation-email: RESEND_API_KEY no configurado.');
    return json({ code: 'EMAIL_NOT_CONFIGURED', error: 'El envío de correos no está configurado todavía.' }, 502);
  }

  const fromEmail = await fetchResendFromEmail(serviceClient);
  const email = buildCustomerEmail(lead.name);
  const result = await sendViaResend(resendApiKey, fromEmail, {
    to: [lead.email],
    subject: email.subject,
    html: email.html,
    text: email.text
  });

  if (!result.sent) {
    await serviceClient
      .from('leads')
      .update({ email_status: 'failed', email_error: result.error ?? 'Resend rechazó el envío.' })
      .eq('id', leadId);

    return json({ code: 'EMAIL_SEND_FAILED', error: 'No se pudo reenviar el correo. Intenta de nuevo.' }, 502);
  }

  const sentAt = new Date().toISOString();

  const { error: updateError } = await serviceClient
    .from('leads')
    .update({ email_status: 'sent', email_sent_at: sentAt, email_error: null })
    .eq('id', leadId);

  if (updateError) {
    console.error('resend-confirmation-email: el correo se envió pero no se pudo actualizar el lead', updateError);
    return json({ code: 'INTERNAL_ERROR', error: 'El correo se envió, pero no se pudo registrar. Refresca la página.' }, 500);
  }

  const { error: auditError } = await serviceClient.from('audit_log').insert({
    entity_type: 'lead',
    entity_id: leadId,
    actor_id: userData.user.id,
    action: 'confirmation_email_resent',
    summary: 'Reenvió el correo de confirmación al cliente'
  });
  if (auditError) {
    console.error('resend-confirmation-email: no se pudo registrar en audit_log', auditError);
  }

  return json({ ok: true, emailSentAt: sentAt }, 200);
});
