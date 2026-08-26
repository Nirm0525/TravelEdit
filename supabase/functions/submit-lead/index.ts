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

const NOTIFICATION_EMAIL = 'marcela@travelinternational.org';

/** Best-effort: si Resend no está configurado o falla, no debe tumbar la
 *  solicitud — el lead ya quedó guardado en la base, que es la fuente de
 *  verdad. Esto es solo un aviso adicional. */
async function sendNotificationEmail(
  name: string,
  email: string,
  phone: string,
  destinationInterestText: string | null,
  details: LeadTripDetails
): Promise<void> {
  const apiKey = Deno.env.get('RESEND_API_KEY');
  if (!apiKey) {
    return;
  }

  const rows: Array<[string, string | undefined]> = [
    ['Nombre', name],
    ['Correo', email],
    ['Teléfono', phone],
    ['Destino de interés', destinationInterestText ?? undefined],
    ['Viaja con', details.travelingWith],
    ['Ocasión', details.occasion],
    ['Presupuesto', details.budgetRange],
    ['Cómo nos conoció', details.hearAboutUs]
  ];

  const html = `
    <h2>Nueva solicitud — The Travel Edit</h2>
    <table cellpadding="6">
      ${rows
        .filter(([, value]) => !!value)
        .map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`)
        .join('')}
    </table>
    <p>Revisa el detalle completo en el panel administrativo.</p>
  `;

  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'The Travel Edit <onboarding@resend.dev>',
        to: [NOTIFICATION_EMAIL],
        subject: `Nueva solicitud de ${name}`,
        html
      })
    });
  } catch {
    // best-effort, no bloquea la respuesta al usuario
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

    const origin: Origin = 'formulario_web';
    const { error } = await serviceClient.from('leads').insert({
      name,
      email,
      phone,
      destination_interest_text: body.destinationInterestText?.trim() || null,
      details: body.details ?? {},
      origin
    });

    if (error) {
      console.error('submit-lead: insert en leads falló', error);
      return json({ error: 'No se pudo enviar la solicitud.' }, 500);
    }

    await sendNotificationEmail(name, email, phone, body.destinationInterestText?.trim() || null, body.details ?? {});

    return json({ ok: true }, 200);
  } catch (err) {
    console.error('submit-lead: error inesperado', err);
    return json({ error: 'No pudimos procesar tu solicitud. Inténtalo nuevamente.' }, 500);
  }
});
