// Carga y validación de la propuesta a enviar (modo "proposal" de send-proposal), separada de Deno.serve para probarla.
//
// send-proposal es EXCLUSIVO de kind = 'proposal': el correo habla de «propuesta», «inversión» y «condiciones», y el
// itinerario (0055) tiene su propio flujo de compartir (0056). Un itinerario se rechaza ANTES de leer con service_role,
// de resolver destinatario, de llamar a Resend y de tocar leads o audit_log: no envía nada ni muta nada.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

// deno-lint-ignore no-explicit-any
type Client = SupabaseClient<any, any, any, any, any>;

export interface ProposalToSend {
  id: string;
  kind: string;
  status: string;
  public_token: string;
  lead_id: string | null;
  client_name: string;
  client_email: string | null;
  access_required: boolean;
  advisor_id: string | null;
}

export type SourceResult = { proposal: ProposalToSend } | { status: number; body: { code: string; error: string } };

const KIND_NOT_SUPPORTED = {
  status: 409,
  body: { code: 'KIND_NOT_SUPPORTED', error: 'Este envío es solo para propuestas. Los itinerarios se comparten con su propio flujo.' }
} as const;

export async function loadProposalToSend(callerClient: Client, serviceClient: Client, proposalId: string): Promise<SourceResult> {
  // Una asesora solo puede enviar SUS propuestas: se confirma con el cliente del propio usuario (RLS) — si la propuesta
  // es de otra asesora, no la ve. De paso se lee el tipo: un itinerario se corta aquí.
  const { data: visible } = await callerClient.from('proposals').select('id, kind').eq('id', proposalId).maybeSingle();
  const seen = visible as { id: string; kind?: string } | null;
  if (!seen) {
    return { status: 403, body: { code: 'FORBIDDEN', error: 'No tienes acceso a esta propuesta.' } };
  }
  if (seen.kind !== 'proposal') {
    return { ...KIND_NOT_SUPPORTED };
  }

  const { data, error } = await serviceClient
    .from('proposals')
    .select('id, kind, status, public_token, lead_id, client_name, client_email, access_required, advisor_id')
    .eq('id', proposalId)
    .maybeSingle();
  if (error) {
    console.error('send-proposal (proposal): error leyendo la propuesta', error);
    return { status: 500, body: { code: 'INTERNAL_ERROR', error: 'No se pudo cargar la propuesta.' } };
  }
  const proposal = data as ProposalToSend | null;
  if (!proposal) {
    return { status: 404, body: { code: 'NOT_FOUND', error: 'La propuesta no existe.' } };
  }
  // Defensa en profundidad: el tipo se revalida con la lectura de service_role (la de arriba depende de RLS).
  if (proposal.kind !== 'proposal') {
    return { ...KIND_NOT_SUPPORTED };
  }

  // La UI ya oculta el botón fuera de published/viewed, pero el status real siempre se revalida acá — nunca
  // se confía únicamente en lo que Angular decidió mostrar.
  if (proposal.status !== 'published' && proposal.status !== 'viewed') {
    return { status: 400, body: { code: 'INVALID_STATUS', error: 'Solo se puede enviar una propuesta publicada.' } };
  }
  return { proposal };
}
