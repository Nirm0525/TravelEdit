// Edge Function: notify-proposal-activity
//
// Avisa al equipo cuando el cliente, desde la propuesta privada:
//   - 'feedback': pulsa "Enviar comentarios a mi asesora" -> UN solo correo con
//     todos los comentarios que dejo en los servicios.
//   - 'accepted': acepta la propuesta (los comentarios pendientes van incluidos).
//
// Destinatarios (siempre resueltos server-side, nunca desde el body): el
// correo admin de Configuracion (la jefa, hoy Marcela) y la asesora asignada
// a la propuesta. Es publica (verify_jwt=false, ver config.toml) pero exige
// una sesion vigente de proposal_access_sessions emitida para ese mismo token.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { loadProposalForActivity } from './proposal-access.ts';

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
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:1.6; color:#CAAE97; text-align:center;">${legalLine}</p>
      </td>
    </tr>`;
}

function emailShellHtml(bodyRowsHtml: string, legalLine: string): string {
  return `
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0; padding:0; background:#E9DFD3;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9DFD3;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <!--[if mso]><table role="presentation" width="520" cellpadding="0" cellspacing="0" align="center"><tr><td><![endif]-->
          <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="width:100%; max-width:520px; background:#F6EFE6;">
            ${emailHeaderHtml()}
            ${bodyRowsHtml}
            ${emailFooterHtml(legalLine)}
          </table>
          <!--[if mso]></td></tr></table><![endif]-->
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
      console.error('notify-proposal-activity: Resend respondió', response.status, await response.text());
      return { sent: false, error: `Resend respondió ${response.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.error('notify-proposal-activity: error inesperado enviando email', err);
    return { sent: false, error: 'error de red hacia Resend' };
  }
}


const FALLBACK_ADMIN_EMAIL = 'marcela@travelinternational.org';
const FEEDBACK_MIN_INTERVAL_MS = 30_000;

// deno-lint-ignore no-explicit-any
async function fetchResendFromEmail(serviceClient: any): Promise<string> {
  try {
    const { data } = await serviceClient.from('site_settings').select('value').eq('key', 'resend_from_email').maybeSingle();
    if (typeof data?.value === 'string' && data.value) {
      return data.value;
    }
  } catch (err) {
    console.error('notify-proposal-activity: no se pudo leer resend_from_email, se usa el fallback.', err);
  }
  return Deno.env.get('RESEND_FROM_EMAIL') || FALLBACK_FROM_EMAIL;
}

// deno-lint-ignore no-explicit-any
async function fetchAdminEmail(serviceClient: any): Promise<string> {
  try {
    const { data } = await serviceClient.from('site_settings').select('value').eq('key', 'leads_admin_email').maybeSingle();
    if (typeof data?.value === 'string' && data.value) {
      return data.value;
    }
  } catch (err) {
    console.error('notify-proposal-activity: no se pudo leer leads_admin_email, se usa el fallback.', err);
  }
  return Deno.env.get('LEADS_ADMIN_EMAIL') || FALLBACK_ADMIN_EMAIL;
}

interface ServiceComment {
  day: string;
  service: string;
  comment: string;
}

// deno-lint-ignore no-explicit-any
function collectComments(content: any, comments: Record<string, unknown>): ServiceComment[] {
  const out: ServiceComment[] = [];
  const days = Array.isArray(content?.days) ? content.days : [];
  for (const day of days) {
    const services = Array.isArray(day?.services) ? day.services : [];
    for (const service of services) {
      const text = comments[service?.id];
      if (typeof text === 'string' && text.trim()) {
        out.push({
          day: `Día ${day.dayNumber ?? ''}${day.title ? ` · ${day.title}` : ''}`.trim(),
          service: service.title || 'Servicio',
          comment: text.trim()
        });
      }
    }
  }
  return out;
}

function buildActivityEmail(opts: {
  event: 'feedback' | 'accepted';
  clientName: string;
  title: string;
  advisorName: string;
  acceptedBy: string | null;
  comments: ServiceComment[];
  panelUrl: string;
}): EmailContent {
  const { event, comments } = opts;
  const clientName = escapeHtml(opts.clientName);
  const title = escapeHtml(opts.title);
  const advisor = escapeHtml(opts.advisorName);
  const fecha = formatFechaCorta(new Date());

  const eyebrow = event === 'accepted' ? 'PROPUESTA ACEPTADA' : 'CAMBIOS SOLICITADOS';
  const heading = event === 'accepted' ? `${clientName} aceptó<br />la propuesta.` : `${clientName} dejó<br />comentarios.`;
  const intro =
    event === 'accepted'
      ? `${clientName}${opts.acceptedBy ? ` (aceptada por ${escapeHtml(opts.acceptedBy)})` : ''} aceptó <strong>${title}</strong>.${comments.length ? ' Antes de aceptar dejó estos comentarios:' : ''}`
      : `${clientName} revisó <strong>${title}</strong> y pidió ajustes en ${comments.length} ${comments.length === 1 ? 'servicio' : 'servicios'}:`;

  const commentRows = comments
    .map(
      (c) => `
    <tr>
      <td style="padding:0 28px 14px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EFE5D8; border-left:3px solid #C79A5B;">
          <tr>
            <td style="padding:12px 14px;">
              <p style="margin:0 0 3px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:1px; color:#7A2338;">${escapeHtml(c.day.toUpperCase())}</p>
              <p style="margin:0 0 6px; font-family:Arial,Helvetica,sans-serif; font-size:13px; font-weight:bold; color:#16110F;">${escapeHtml(c.service)}</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#16110F;">${escapeHtml(c.comment).replace(/\n/g, '<br />')}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
    )
    .join('');

  const bodyRows = `
    <tr>
      <td style="background:#6D2A34; padding:32px 28px 34px; border-radius:2px;">
        <p style="margin:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:2px; color:#CAAE97;">&mdash; ${eyebrow} &middot; ${fecha}</p>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:28px; line-height:1.2; color:#F6EFE6;">${heading}</p>
      </td>
    </tr>

    <tr>
      <td style="padding:24px 28px 16px;">
        <p style="margin:0 0 6px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.6; color:#16110F;">${intro}</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; color:#8A7F76;">Asesora: ${advisor}</p>
      </td>
    </tr>
    ${commentRows}
    <tr>
      <td align="center" style="padding:14px 28px 32px;">
        <a href="${escapeHtml(opts.panelUrl)}" style="display:inline-block; background:#6D2A34; color:#F6EFE6; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; letter-spacing:2px; padding:14px 32px;">ABRIR EN EL PANEL</a>
      </td>
    </tr>`;

  const html = emailShellHtml(bodyRows, 'Aviso interno del panel de The Travel Edit.');
  const text = [
    event === 'accepted' ? `${opts.clientName} aceptó la propuesta "${opts.title}".` : `${opts.clientName} dejó comentarios en "${opts.title}".`,
    `Asesora: ${opts.advisorName}`,
    '',
    ...comments.flatMap((c) => [`${c.day} — ${c.service}`, c.comment, '']),
    `Abrir en el panel: ${opts.panelUrl}`
  ].join('\n');

  return {
    subject: event === 'accepted' ? `Propuesta aceptada — ${opts.clientName}` : `Cambios solicitados — ${opts.clientName}`,
    html,
    text
  };
}

/** Lo único que la prueba de punta a punta necesita sustituir: cómo se crea el cliente de Supabase. */
export interface Deps {
  createClient: typeof createClient;
}

const defaultDeps: Deps = { createClient };

export async function handleRequest(req: Request, deps: Deps = defaultDeps): Promise<Response> {
  const cors = corsHeadersFor(req);
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    const body = (await req.json()) as { token?: string; sessionToken?: string; event?: string };
    const { token, sessionToken, event } = body;
    if (!token || !sessionToken || (event !== 'feedback' && event !== 'accepted')) {
      return json({ error: 'Solicitud inválida.' }, 400);
    }

    const serviceClient = deps.createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    // Sesión vigente + public_token + tipo. Un itinerario se rechaza aquí (409), antes de cualquier correo o escritura.
    const access = await loadProposalForActivity(serviceClient, token, sessionToken);
    if (!('proposal' in access)) {
      return json(access.body, access.status);
    }
    const { proposal } = access;

    const comments = collectComments(proposal.content, (proposal.service_comments ?? {}) as Record<string, unknown>);

    if (event === 'feedback') {
      if (comments.length === 0) {
        return json({ error: 'No hay comentarios para enviar.' }, 400);
      }
      if (proposal.feedback_sent_at && Date.now() - new Date(proposal.feedback_sent_at).getTime() < FEEDBACK_MIN_INTERVAL_MS) {
        return json({ ok: true, skipped: true }, 200);
      }
    } else {
      if (proposal.status !== 'accepted') {
        return json({ error: 'La propuesta todavía no está aceptada.' }, 400);
      }
      if (proposal.accepted_notified_at) {
        return json({ ok: true, skipped: true }, 200);
      }
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      console.error('notify-proposal-activity: RESEND_API_KEY no configurado.');
      return json({ ok: false, error: 'Correo no configurado.' }, 200);
    }

    let advisorName = 'Sin asignar';
    let advisorEmail: string | null = null;
    if (proposal.advisor_id) {
      const { data: profile } = await serviceClient.from('profiles').select('full_name').eq('id', proposal.advisor_id).maybeSingle();
      if (profile?.full_name) {
        advisorName = profile.full_name;
      }
      const { data: authUser } = await serviceClient.auth.admin.getUserById(proposal.advisor_id);
      advisorEmail = authUser?.user?.email ?? null;
    }

    const adminEmail = await fetchAdminEmail(serviceClient);
    const recipients = [...new Set([adminEmail, advisorEmail].filter((e): e is string => !!e).map((e) => e.toLowerCase()))];

    const email = buildActivityEmail({
      event,
      clientName: proposal.client_name ?? 'El cliente',
      title: proposal.title || 'la propuesta',
      advisorName,
      acceptedBy: proposal.accepted_by_name ?? null,
      comments,
      panelUrl: `${SITE}/admin/proposals/${proposal.id}/edit`
    });

    const fromEmail = await fetchResendFromEmail(serviceClient);
    const result = await sendViaResend(resendApiKey, fromEmail, { to: recipients, ...email });
    if (!result.sent) {
      return json({ ok: false, error: result.error }, 200);
    }

    await serviceClient
      .from('proposals')
      .update(event === 'feedback' ? { feedback_sent_at: new Date().toISOString() } : { accepted_notified_at: new Date().toISOString() })
      .eq('id', proposal.id);

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('notify-proposal-activity: error inesperado', err);
    return json({ error: 'No se pudo enviar el aviso.' }, 500);
  }
}
