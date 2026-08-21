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

async function verifyTurnstile(token: string, remoteIp: string): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET_KEY');
  if (!secret) {
    return false;
  }

  const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token, remoteip: remoteIp })
  });

  const result = (await response.json()) as { success: boolean };
  return result.success;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido.' }), { status: 405 });
  }

  const body = (await req.json()) as LeadRequestBody;
  const name = body.name?.trim() ?? '';
  const email = body.email?.trim() ?? '';
  const phone = body.phone?.trim() ?? '';

  if (!name || !isValidEmail(email) || !phone) {
    return new Response(JSON.stringify({ error: 'Nombre, correo válido y teléfono son obligatorios.' }), { status: 400 });
  }

  if (!body.turnstileToken) {
    return new Response(JSON.stringify({ error: 'Falta la verificación anti-spam.' }), { status: 400 });
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
    return new Response(JSON.stringify({ error: 'Demasiados intentos. Intenta de nuevo más tarde.' }), { status: 429 });
  }

  const captchaOk = await verifyTurnstile(body.turnstileToken, remoteIp);
  if (!captchaOk) {
    return new Response(JSON.stringify({ error: 'No se pudo verificar que eres una persona.' }), { status: 400 });
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
    return new Response(JSON.stringify({ error: 'No se pudo enviar la solicitud.' }), { status: 500 });
  }

  await sendNotificationEmail(name, email, phone, body.destinationInterestText?.trim() || null, body.details ?? {});

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});
