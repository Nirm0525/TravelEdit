// Acceso a la propuesta de notify-proposal-activity (sesión + public_token + tipo), separado de Deno.serve para probarlo.
//
// Esta función avisa al equipo de lo que hace el CLIENTE en una PROPUESTA comercial: comentarios sobre servicios y aceptación.
// Un itinerario (kind = 'itinerary', 0055) no tiene ni aceptación ni elección de servicios, y su aviso (si llega a haberlo)
// llega con 0056. Hasta entonces se rechaza de forma EXPLÍCITA (409 kind_not_supported) antes de leer comentarios, resolver
// destinatarios, llamar a Resend o escribir en la base: preferimos un rechazo claro a un comportamiento parcial.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any, any, any>;

export interface ProposalForActivity {
  id: string;
  kind: string;
  public_token: string;
  status: string;
  client_name: string | null;
  title: string | null;
  content: unknown;
  advisor_id: string | null;
  service_comments: unknown;
  accepted_by_name: string | null;
  feedback_sent_at: string | null;
  accepted_notified_at: string | null;
}

export type AccessResult = { proposal: ProposalForActivity } | { status: number; body: { error: string; code?: string } };

export async function loadProposalForActivity(serviceClient: Client, token: string, sessionToken: string, now: () => number = Date.now): Promise<AccessResult> {
  const { data: session } = await serviceClient.from('proposal_access_sessions').select('proposal_id, expires_at').eq('id', sessionToken).maybeSingle();
  const row = session as { proposal_id: string; expires_at: string } | null;
  if (!row || new Date(row.expires_at).getTime() <= now()) {
    return { status: 401, body: { error: 'Sesión inválida.' } };
  }

  const { data } = await serviceClient
    .from('proposals')
    .select('id, kind, public_token, status, client_name, title, content, advisor_id, service_comments, accepted_by_name, feedback_sent_at, accepted_notified_at')
    .eq('id', row.proposal_id)
    .eq('public_token', token)
    .maybeSingle();
  const proposal = data as ProposalForActivity | null;
  if (!proposal) {
    return { status: 404, body: { error: 'Propuesta no encontrada.' } };
  }
  if (proposal.kind !== 'proposal') {
    return { status: 409, body: { error: 'Este aviso es solo para propuestas.', code: 'kind_not_supported' } };
  }
  return { proposal };
}
