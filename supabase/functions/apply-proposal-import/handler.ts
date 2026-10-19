// Lógica de apply-proposal-import (modo "new"), separada de Deno.serve y de supabase-js para poder
// probarla con dependencias falsas. Los permisos de lectura los decide la base (RLS) con el cliente
// del usuario; la escritura (propuesta + importación) va en una sola transacción (tx.ts).
import { corsHeadersFor } from '../_shared/cors.ts';
import { ExtractionSchema } from '../_shared/proposal-extraction.ts';
import { mapExtractionToProposal, type MappedProposal } from '../_shared/proposal-mapping.ts';
import { ORIGIN_CHANNELS, type OriginChannel } from './tx.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportRow {
  id: string;
  mode: string;
  status: string;
  file_path: string;
  created_by: string;
  extracted: unknown;
}

export interface Deps {
  env(name: string): string | undefined;
  getUser(token: string): Promise<{ id: string } | null>;
  /** Lee la fila con el cliente del usuario: si RLS no la devuelve, null. */
  getImportAsUser(token: string, importId: string): Promise<ImportRow | null>;
  canManageProposals(token: string): Promise<boolean>;
  /** ¿El usuario puede ver ese lead? (RLS de leads, con el cliente del usuario) */
  canSeeLead(token: string, leadId: string): Promise<boolean>;
  /** Transacción: 'conflict' si la importación ya no estaba 'ready'. Lanza si algo falla (todo revertido). */
  applyImport(args: {
    importId: string;
    userId: string;
    originChannel: OriginChannel;
    leadId: string | null;
    mapped: MappedProposal;
  }): Promise<string | 'conflict'>;
  /** Borra el PDF del bucket (API de Storage). */
  deleteFile(path: string): Promise<void>;
  log(message: string, meta?: Record<string, unknown>): void;
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeadersFor(req, deps.env('ALLOWED_ORIGINS'));
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json({ error: 'Falta el token de sesión.' }, 401);
    }
    const user = await deps.getUser(token);
    if (!user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    const importId = body?.import_id;
    const leadId = body?.lead_id ?? null;
    if (typeof importId !== 'string' || !UUID.test(importId)) {
      return json({ error: 'Solicitud inválida.' }, 400);
    }
    if (leadId !== null && (typeof leadId !== 'string' || !UUID.test(leadId))) {
      return json({ error: 'La solicitud (lead) indicada no es válida.' }, 400);
    }
    // Con lead vinculado el canal es siempre 'web' (las solicitudes llegan por el sitio).
    const requested = body?.origin_channel;
    const originChannel: OriginChannel | null =
      leadId !== null ? 'web' : (ORIGIN_CHANNELS as readonly unknown[]).includes(requested) ? (requested as OriginChannel) : null;
    if (originChannel === null) {
      return json({ error: 'Indica por dónde llegó el cliente.' }, 400);
    }

    // 1) La base decide si el usuario ve la importación.
    const row = await deps.getImportAsUser(token, importId);
    if (!row) {
      return json({ error: 'No se encontró la importación.' }, 404);
    }

    // 2) Solo modo "new" y ya procesada.
    if (row.mode !== 'new') {
      return json({ error: 'Esta importación no es para crear una propuesta nueva.' }, 409);
    }
    if (row.status !== 'ready') {
      return json({ error: 'Esta importación no está lista o ya se aplicó.' }, 409);
    }

    if (!(await deps.canManageProposals(token))) {
      return json({ error: 'No tienes permiso para crear propuestas.' }, 403);
    }

    // 3) El lead debe ser visible para el usuario.
    if (leadId !== null && !(await deps.canSeeLead(token, leadId as string))) {
      return json({ error: 'No tienes acceso a esa solicitud.' }, 403);
    }

    const parsed = ExtractionSchema.safeParse(row.extracted);
    if (!parsed.success) {
      deps.log('apply.invalid_extracted', { importId });
      return json({ error: 'Los datos extraídos no son válidos. Vuelve a procesar el PDF.' }, 422);
    }
    const mapped = mapExtractionToProposal(parsed.data);

    // 4) Una sola transacción.
    const result = await deps.applyImport({
      importId,
      userId: user.id,
      originChannel,
      leadId: leadId as string | null,
      mapped
    });
    if (result === 'conflict') {
      return json({ error: 'Esta importación ya se aplicó en otra pestaña.' }, 409);
    }

    // 5) Después del commit se borra el PDF; si falla, se registra pero la respuesta sigue siendo éxito.
    try {
      await deps.deleteFile(row.file_path);
    } catch (err) {
      deps.log('apply.delete_file_failed', { importId, error: (err as Error).message });
    }

    return json({ proposal_id: result }, 200);
  } catch (err) {
    deps.log('apply.unexpected_error', { error: (err as Error).message });
    return json({ error: 'No se pudo crear la propuesta. Inténtalo de nuevo.' }, 500);
  }
}
