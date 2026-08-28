// Edge Function: send-proposal
//
// El botón "Enviar propuesta" del detalle de solicitud llama aquí. A
// diferencia de submit-lead (público, sin JWT), esta función SÍ requiere
// sesión: solo staff/admin puede enviar propuestas, así que corre con la
// verificación de JWT del gateway activada por defecto (no hay entrada
// [functions.send-proposal] en config.toml — ese es justamente el
// comportamiento que queremos, verify_jwt=true).
//
// El frontend manda solo { leadId, subject, message } — nunca un correo
// destinatario. El correo real se lee siempre de `leads.email` con la
// service role, para que no haya forma de que alguien mande una propuesta
// a un destinatario arbitrario manipulando el body de la request.
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

// Mismos secrets y mismo remitente por defecto que submit-lead — no se crea
// una segunda integración de correo.
const FALLBACK_FROM_EMAIL = 'The Travel Edit <onboarding@resend.dev>';
const SITE = 'https://thetravel-edit.com';

const MESES_CORTOS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];
function formatFechaCorta(date: Date): string {
  return `${date.getDate()} ${MESES_CORTOS[date.getMonth()]} ${date.getFullYear()}`;
}

// Mismo header/footer de marca que submit-lead (ver ese archivo para el
// razonamiento de tablas + Georgia como aproximación web-safe).
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

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

// `subject` y `message` vienen de un administrador autenticado, no de un
// visitante anónimo — pero igual se escapan antes de insertarlos en HTML,
// porque terminan en el correo de un cliente real y un editor/staff no
// debería poder inyectar markup ahí por error (o intencionalmente).
function buildProposalEmail(clientName: string, subject: string, message: string): EmailContent {
  const safeName = escapeHtml(clientName.split(' ')[0] || clientName);
  const safeSubject = escapeHtml(subject);
  const safeMessageHtml = escapeHtml(message).replace(/\n/g, '<br />');
  const fecha = formatFechaCorta(new Date());

  const bodyRows = `
    <tr>
      <td style="background:#6D2A34; padding:32px 32px 36px; border-radius:2px;">
        <p style="margin:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; letter-spacing:2px; color:#CAAE97;">TU PROPUESTA DE VIAJE &middot; ${fecha}</p>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:30px; line-height:1.25; color:#F6EFE6;">Hola ${safeName},<br />esto es lo que pensamos para ti.</p>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 32px 8px;">
        <p style="margin:0 0 16px; font-family:Arial,Helvetica,sans-serif; font-size:16px; font-weight:bold; color:#7A2338;">${safeSubject}</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:1.7; color:#16110F;">${safeMessageHtml}</p>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 32px 8px;">
        <a href="mailto:info@thetravel-edit.com" style="display:inline-block; background:#6D2A34; color:#F6EFE6; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; letter-spacing:2px; padding:14px 28px;">RESPONDER A ESTA PROPUESTA</a>
      </td>
    </tr>

    <tr>
      <td style="padding:20px 32px 32px;">
        <div style="border-top:1px solid #C79A5B; margin:0 0 20px;"></div>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:17px; color:#6D2A34;">Estamos listos para ajustar cualquier detalle.</p>
      </td>
    </tr>`;

  const html = emailShellHtml(bodyRows, 'Recibes este correo porque solicitaste un viaje a medida con The Travel Edit.');
  const text = [`Hola ${clientName}, esto es lo que pensamos para ti.`, '', subject, '', message, '', 'The Travel Edit'].join('\n');

  return { subject: `Tu propuesta de viaje — ${subject}`, html, text };
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
      console.error('send-proposal: Resend respondió', response.status, await response.text());
      return { sent: false, error: `Resend respondió ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('send-proposal: error inesperado enviando email', err);
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
    console.error('send-proposal: no se pudo leer resend_from_email de site_settings, se usa el fallback.', err);
  }
  return Deno.env.get('RESEND_FROM_EMAIL') || FALLBACK_FROM_EMAIL;
}

interface RequestBody {
  leadId?: string;
  subject?: string;
  message?: string;
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

  // callerClient corre con la sesión real del usuario (anon key + su JWT) —
  // se usa solo para confirmar quién es y para invocar can_manage_leads() en
  // su propio contexto, nunca para leer/escribir leads directamente.
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', error: 'Sesión inválida.' }, 401);
  }

  // Mecanismo de permisos existente: can_manage_leads() = rol admin o staff
  // (0007_roles_permissions.sql). 'editor' queda afuera, igual que en las
  // policies de leads_update/leads_select.
  const { data: canManage, error: canManageError } = await callerClient.rpc('can_manage_leads');
  if (canManageError || canManage !== true) {
    return json({ code: 'FORBIDDEN', error: 'No tienes permiso para enviar propuestas.' }, 403);
  }

  const body = (await req.json().catch(() => null)) as RequestBody | null;
  const leadId = typeof body?.leadId === 'string' ? body.leadId.trim() : '';
  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const message = typeof body?.message === 'string' ? body.message.trim() : '';

  if (!leadId) {
    return json({ code: 'BAD_REQUEST', error: 'Falta la solicitud a la que enviar la propuesta.' }, 400);
  }
  if (!subject) {
    return json({ code: 'BAD_REQUEST', error: 'El asunto es obligatorio.' }, 400);
  }
  if (!message) {
    return json({ code: 'BAD_REQUEST', error: 'El mensaje es obligatorio.' }, 400);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  // El correo del destinatario SIEMPRE se lee de la base, nunca del body de
  // la request — así el frontend no puede mandar un destinatario arbitrario
  // aunque lo intente.
  const { data: lead, error: leadError } = await serviceClient
    .from('leads')
    .select('id, name, email, status')
    .eq('id', leadId)
    .maybeSingle();

  if (leadError) {
    console.error('send-proposal: error leyendo el lead', leadError);
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
    console.error('send-proposal: RESEND_API_KEY no configurado.');
    return json({ code: 'EMAIL_NOT_CONFIGURED', error: 'El envío de correos no está configurado todavía.' }, 502);
  }

  const fromEmail = await fetchResendFromEmail(serviceClient);
  const email = buildProposalEmail(lead.name, subject, message);
  const result = await sendViaResend(resendApiKey, fromEmail, {
    to: [lead.email],
    subject: email.subject,
    html: email.html,
    text: email.text
  });

  if (!result.sent) {
    // No se toca proposal_subject/proposal_message/proposal_sent_at/
    // proposal_sent_by — si ya había una propuesta enviada antes, ese
    // registro se conserva intacto; solo se refleja que ESTE intento falló.
    await serviceClient
      .from('leads')
      .update({ proposal_email_status: 'failed', proposal_email_error: result.error ?? 'Resend rechazó el envío.' })
      .eq('id', leadId);

    return json({ code: 'EMAIL_SEND_FAILED', error: 'No se pudo enviar la propuesta. Intenta de nuevo.' }, 502);
  }

  const sentAt = new Date().toISOString();

  // 'nueva'/'contactada' -> 'propuesta_enviada' es un avance natural del
  // pipeline; si el lead ya estaba más adelante (propuesta_enviada de antes,
  // o cerrado) no se mueve el estado hacia atrás ni se toca uno cerrado.
  const nextStatus = lead.status === 'nueva' || lead.status === 'contactada' ? 'propuesta_enviada' : lead.status;

  const { error: updateError } = await serviceClient
    .from('leads')
    .update({
      proposal_subject: subject,
      proposal_message: message,
      proposal_sent_at: sentAt,
      proposal_sent_by: userData.user.id,
      proposal_email_status: 'sent',
      proposal_email_error: null,
      status: nextStatus
    })
    .eq('id', leadId);

  if (updateError) {
    console.error('send-proposal: el correo se envió pero no se pudo actualizar el lead', updateError);
    return json({ code: 'INTERNAL_ERROR', error: 'La propuesta se envió, pero no se pudo registrar. Refresca la página.' }, 500);
  }

  const { error: auditError } = await serviceClient.from('audit_log').insert({
    entity_type: 'lead',
    entity_id: leadId,
    actor_id: userData.user.id,
    action: 'proposal_sent',
    summary: 'Propuesta enviada por correo al cliente'
  });
  if (auditError) {
    // Best-effort — el envío y la actualización del lead ya son la fuente de
    // verdad; un fallo solo de auditoría no debe reportarse como error al UI.
    console.error('send-proposal: no se pudo registrar en audit_log', auditError);
  }

  return json({ ok: true, proposalSentAt: sentAt, status: nextStatus }, 200);
});
