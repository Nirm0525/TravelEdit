// Edge Function: send-itinerary — «Enviar al cliente» de un ITINERARIO ya compartido.
//
// Contrato propio, separado de send-proposal (que sigue siendo EXCLUSIVA de propuestas y rechaza un itinerario):
//   - Entrada: { itineraryId }. Nunca destinatario, asunto ni texto: el correo sale de client_email y de una plantilla fija.
//   - Solo itinerarios compartidos (shared | viewed), por quien puede compartirlos (can_travel + propiedad de la asesora).
//   - El correo lleva el enlace privado oficial (/private/<public_token>) y, si el acceso lo exige, solo AVISA de que hay un
//     código: el código viaja por otro canal. No lleva precios ni lenguaje de propuesta.
//   - Audita itinerary_email_sent. No toca solicitudes (leads): un itinerario no se vincula a ellas.
//   - Un fallo en cualquier paso no envía nada ni escribe nada.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeadersFor, fetchResendFromEmail, SITE, sendViaResend } from '../_shared/email-brand.ts';
import { buildItineraryEmail } from './itinerary-email.ts';
import { loadItineraryToSend } from './itinerary-source.ts';

/** Lo único que la prueba de punta a punta sustituye: cómo se crean los clientes de Supabase y cómo se llama a Resend. */
export interface Deps {
  createClient: typeof createClient;
  fetchImpl?: typeof fetch;
  now?: () => number;
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
  // callerClient corre con la sesión real del usuario: confirma quién es y pregunta a la base (RLS, can_travel, propiedad).
  const callerClient = deps.createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', error: 'Sesión inválida.' }, 401);
  }
  const callerId = userData.user.id;

  const body = (await req.json().catch(() => null)) as { itineraryId?: unknown } | null;
  const itineraryId = typeof body?.itineraryId === 'string' ? body.itineraryId.trim() : '';
  if (!itineraryId) {
    return json({ code: 'BAD_REQUEST', error: 'Falta el itinerario a enviar.' }, 400);
  }

  const serviceClient = deps.createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const loaded = await loadItineraryToSend(callerClient, serviceClient, itineraryId, deps.now);
  if (!('itinerary' in loaded)) {
    return json(loaded.body, loaded.status);
  }
  const { itinerary } = loaded;

  const resendApiKey = Deno.env.get('RESEND_API_KEY');
  if (!resendApiKey) {
    console.error('send-itinerary: RESEND_API_KEY no configurado.');
    return json({ code: 'EMAIL_NOT_CONFIGURED', error: 'El envío de correos no está configurado todavía.' }, 502);
  }

  const email = buildItineraryEmail({
    clientName: itinerary.client_name ?? '',
    privateUrl: `${SITE}/private/${itinerary.public_token}`,
    accessRequired: itinerary.access_required === true
  });
  const fromEmail = await fetchResendFromEmail(serviceClient);

  // Las respuestas del cliente van directo a su asesora.
  let advisorEmail: string | undefined;
  if (itinerary.advisor_id) {
    const { data: advisorUser } = await serviceClient.auth.admin.getUserById(itinerary.advisor_id);
    advisorEmail = advisorUser?.user?.email ?? undefined;
  }

  const result = await sendViaResend(
    resendApiKey,
    fromEmail,
    { to: [itinerary.client_email as string], replyTo: advisorEmail, subject: email.subject, html: email.html, text: email.text },
    deps.fetchImpl
  );
  if (!result.sent) {
    return json({ code: 'EMAIL_SEND_FAILED', error: 'No se pudo enviar el itinerario. Intenta de nuevo.' }, 502);
  }

  const sentAt = new Date().toISOString();
  const { error: auditError } = await serviceClient.from('audit_log').insert({
    entity_type: 'itinerary',
    entity_id: itinerary.id,
    actor_id: callerId,
    action: 'itinerary_email_sent',
    summary: `Itinerario enviado a ${itinerary.client_email}`
  });
  if (auditError) {
    // El correo ya salió: no se falla la respuesta por la auditoría, pero queda en el log.
    console.error('send-itinerary: no se pudo registrar en audit_log');
  }

  return json({ ok: true, sentTo: itinerary.client_email, sentAt }, 200);
}
