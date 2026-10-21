// Carga y validación del itinerario a enviar (send-itinerary), separada del servidor para probarla.
//
// send-itinerary es EXCLUSIVA de kind = 'itinerary' y de un itinerario YA compartido (shared | viewed): nunca comparte por sí
// misma (eso es share_itinerary) y nunca envía el enlace de un borrador. Cada paso rechaza ANTES de leer con service_role, de
// resolver destinatario o de llamar a Resend: un fallo no envía nada ni escribe nada.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any, any, any>;

export interface ItineraryToSend {
  id: string;
  kind: string;
  status: string;
  public_token: string;
  client_name: string;
  client_email: string | null;
  access_required: boolean;
  advisor_id: string | null;
  expires_at: string | null;
}

export type SourceResult = { itinerary: ItineraryToSend } | { status: number; body: { code: string; error: string } };

const fail = (status: number, code: string, error: string): SourceResult => ({ status, body: { code, error } });

// Mismo formato que la restricción de correo de la tabla.
const EMAIL_FORMAT = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function loadItineraryToSend(callerClient: Client, serviceClient: Client, itineraryId: string, now: () => number = Date.now): Promise<SourceResult> {
  // 1) Lo que ESTE usuario ve (RLS): una asesora solo ve sus itinerarios. De paso se lee el tipo.
  const { data: visible } = await callerClient.from('proposals').select('id, kind, advisor_id').eq('id', itineraryId).maybeSingle();
  const seen = visible as { id: string; kind?: string; advisor_id?: string | null } | null;
  if (!seen) {
    return fail(403, 'FORBIDDEN', 'No tienes acceso a este itinerario.');
  }
  if (seen.kind !== 'itinerary') {
    return fail(409, 'KIND_NOT_SUPPORTED', 'Este envío es solo para itinerarios. Las propuestas se envían con su propio flujo.');
  }

  // 2) Permiso por tipo y propiedad, decididos por la base con la sesión del usuario (nunca por esta función).
  const { data: allowed, error: allowedError } = await callerClient.rpc('can_travel', { p_kind: 'itinerary', p_action: 'compartir' });
  if (allowedError || allowed !== true) {
    return fail(403, 'FORBIDDEN', 'No tienes permiso para compartir itinerarios.');
  }
  const { data: own, error: ownError } = await callerClient.rpc('is_own_or_full', { p_owner: seen.advisor_id ?? null });
  if (ownError || own !== true) {
    return fail(403, 'FORBIDDEN', 'Este itinerario pertenece a otra asesora.');
  }

  // 3) Lectura con service_role: solo lo que el correo necesita, y el tipo se revalida.
  const { data, error } = await serviceClient
    .from('proposals')
    .select('id, kind, status, public_token, client_name, client_email, access_required, advisor_id, expires_at')
    .eq('id', itineraryId)
    .maybeSingle();
  if (error) {
    console.error('send-itinerary: error leyendo el itinerario');
    return fail(500, 'INTERNAL_ERROR', 'No se pudo cargar el itinerario.');
  }
  const itinerary = data as ItineraryToSend | null;
  if (!itinerary) {
    return fail(404, 'NOT_FOUND', 'El itinerario no existe.');
  }
  if (itinerary.kind !== 'itinerary') {
    return fail(409, 'KIND_NOT_SUPPORTED', 'Este envío es solo para itinerarios. Las propuestas se envían con su propio flujo.');
  }

  // 4) Solo un itinerario compartido: el enlace de un borrador no entrega nada, así que no se manda.
  if (itinerary.status !== 'shared' && itinerary.status !== 'viewed') {
    return fail(400, 'INVALID_STATUS', 'Primero comparte el itinerario: solo se puede enviar uno compartido.');
  }
  if (itinerary.expires_at !== null && new Date(itinerary.expires_at).getTime() <= now()) {
    return fail(400, 'EXPIRED', 'El acceso a este itinerario venció. Renueva la fecha de expiración antes de enviarlo.');
  }
  if (!itinerary.public_token) {
    return fail(500, 'INTERNAL_ERROR', 'El itinerario no tiene enlace.');
  }

  // 5) Destinatario: siempre el correo guardado en el itinerario, nunca uno del cuerpo de la solicitud.
  const recipient = (itinerary.client_email ?? '').trim();
  if (!EMAIL_FORMAT.test(recipient)) {
    return fail(400, 'NO_RECIPIENT', 'Falta un correo válido del cliente. Agrégalo en «Datos del viaje».');
  }
  return { itinerary: { ...itinerary, client_email: recipient } };
}
