// Documentos adjuntos por servicio — lado CLIENTE (propuesta privada). Lógica separada de Deno.serve y supabase-js.
//
// Entrada: POST { action: 'list' | 'url', token, sessionToken, attachmentId? } sin JWT de usuario: el acceso lo
// decide esta función con consultas explícitas (service_role), con las MISMAS reglas que get_proposal_content
// (supabase/migrations/0040/0043/0051/0055): sesión vigente emitida para ese registro, public_token coincidente, estado
// abierto SEGÚN SU TIPO (proposal: published/viewed/accepted; itinerary: shared/viewed) y registro no expirado. Además solo se entregan documentos con visible_to_client = true.
//
//  - Nunca se devuelve storage_path ni metadata interna: solo id, servicio, nombre y tipo.
//  - La URL firmada se genera al hacer clic y dura 10 minutos; no se guarda en la base.
//  - Cualquier fallo de acceso (token/sesión inválidos, de otra propuesta, expirada, documento no visible o
//    inexistente) devuelve el mismo 404: no se revela qué falló.
//  - No hay ninguna función SECURITY DEFINER: así no se añade superficie expuesta a anon.
import { corsHeadersFor } from '../_shared/cors.ts';
import { SIGNED_URL_TTL_SECONDS, daysOf, isUuid } from '../_shared/service-attachment-rules.ts';

export interface SessionRow {
  proposal_id: string;
  expires_at: string;
}

export interface ProposalRow {
  id: string;
  /** proposals.kind. Un tipo desconocido no abre nada (cierra por defecto). */
  kind: string;
  public_token: string;
  status: string;
  expires_at: string | null;
  content: unknown;
}

export interface VisibleAttachment {
  id: string;
  service_id: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
}

export interface Deps {
  env(name: string): string | undefined;
  getSession(sessionId: string): Promise<SessionRow | null>;
  getProposal(proposalId: string): Promise<ProposalRow | null>;
  /** Solo filas con visible_to_client = true de ESA propuesta. */
  listVisible(proposalId: string): Promise<VisibleAttachment[]>;
  getVisible(proposalId: string, attachmentId: string): Promise<VisibleAttachment | null>;
  createSignedUrl(path: string, ttlSeconds: number, downloadName?: string): Promise<string>;
  log(message: string, meta?: Record<string, unknown>): void;
}

/** Estados en los que el cliente ve el viaje, por tipo (mismo criterio que get_proposal_content en 0055). Un borrador nunca. */
export const OPEN_STATUSES_BY_KIND: Record<string, readonly string[]> = {
  proposal: ['published', 'viewed', 'accepted'],
  itinerary: ['shared', 'viewed']
};

export const isOpen = (kind: string, status: string): boolean => (OPEN_STATUSES_BY_KIND[kind] ?? []).includes(status);

export async function handleRequest(req: Request, deps: Deps, now: () => number = () => Date.now()): Promise<Response> {
  const cors = corsHeadersFor(req, deps.env('ALLOWED_ORIGINS'));
  // Lista y URLs dependen de la sesión y cambian cuando la asesora edita: nunca deben servirse desde una caché.
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' } });
  const notFound = () => json({ error: 'No disponible.' }, 404);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || (body.action !== 'list' && body.action !== 'url')) {
      return json({ error: 'Solicitud inválida.' }, 400);
    }
    const { token, sessionToken } = body;
    if (!isUuid(token) || !isUuid(sessionToken)) {
      return notFound();
    }

    const session = await deps.getSession(sessionToken.toLowerCase());
    if (!session || new Date(session.expires_at).getTime() <= now()) {
      return notFound();
    }
    const proposal = await deps.getProposal(session.proposal_id);
    if (
      !proposal ||
      proposal.public_token.toLowerCase() !== token.toLowerCase() ||
      !isOpen(proposal.kind, proposal.status) ||
      (proposal.expires_at !== null && new Date(proposal.expires_at).getTime() <= now())
    ) {
      return notFound();
    }

    if (body.action === 'list') {
      // Solo documentos de servicios que siguen existiendo en el contenido ACTUAL (se lee de la base en cada solicitud, sin snapshot).
      const serviceIds = new Set(
        daysOf(proposal.content).flatMap((d) => (Array.isArray(d.services) ? d.services : []).map((s) => String((s as { id?: unknown })?.id)))
      );
      const documents = (await deps.listVisible(proposal.id))
        .filter((a) => serviceIds.has(a.service_id))
        .map((a) => ({ id: a.id, serviceId: a.service_id, name: a.file_name, mimeType: a.mime_type }));
      return json({ documents }, 200);
    }

    if (!isUuid(body.attachmentId)) {
      return notFound();
    }
    const attachment = await deps.getVisible(proposal.id, body.attachmentId.toLowerCase());
    if (!attachment) {
      return notFound();
    }
    const url = await deps.createSignedUrl(attachment.storage_path, SIGNED_URL_TTL_SECONDS, body.download === true ? attachment.file_name : undefined);
    return json({ url, expiresInSeconds: SIGNED_URL_TTL_SECONDS }, 200);
  } catch (err) {
    deps.log('documents.unexpected_error', { error: (err as Error).message });
    return json({ error: 'No se pudo completar la operación.' }, 500);
  }
}
