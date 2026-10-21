// Piezas comunes del correo de marca de The Travel Edit para las Edge Functions de envío de ITINERARIOS: CORS, escape de HTML,
// carcasa (cabecera + pie), envío con Resend y remitente configurable. Mismo aspecto y misma integración que send-proposal /
// submit-lead (mismos secrets, mismo remitente por defecto): no es una segunda integración de correo. Se mantiene SEPARADO de
// send-proposal a propósito (esa función no se toca): cada flujo conserva su propio contrato y sus propios textos.

export const SITE = 'https://thetravel-edit.com';
export const FALLBACK_FROM_EMAIL = 'The Travel Edit <onboarding@resend.dev>';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
]);

export function corsHeadersFor(req: Request): Record<string, string> {
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

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

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

export function emailShellHtml(bodyRowsHtml: string, legalLine: string): string {
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

export interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

export interface SendResult {
  sent: boolean;
  error?: string;
}

/** Envío con Resend. `fetchImpl` permite probar sin red. Un fallo no lanza: devuelve { sent: false }. */
export async function sendViaResend(
  apiKey: string,
  fromEmail: string,
  payload: { to: string[]; subject: string; html: string; text: string; replyTo?: string },
  fetchImpl: typeof fetch = fetch
): Promise<SendResult> {
  try {
    const response = await fetchImpl('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
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
      console.error('Resend respondió', response.status);
      return { sent: false, error: `Resend respondió ${response.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error('error inesperado enviando email', (err as Error).name);
    return { sent: false, error: 'error de red hacia Resend' };
  }
}

/** Remitente: el de Configuración (site_settings.resend_from_email), o el secret, o el de siempre. */
// deno-lint-ignore no-explicit-any
export async function fetchResendFromEmail(serviceClient: any): Promise<string> {
  try {
    const { data } = await serviceClient.from('site_settings').select('value').eq('key', 'resend_from_email').maybeSingle();
    const override = data?.value;
    if (typeof override === 'string' && override) {
      return override;
    }
  } catch (err) {
    console.error('no se pudo leer resend_from_email de site_settings, se usa el fallback.', (err as Error).name);
  }
  return Deno.env.get('RESEND_FROM_EMAIL') || FALLBACK_FROM_EMAIL;
}
