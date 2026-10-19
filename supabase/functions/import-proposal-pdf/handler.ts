// Lógica de import-proposal-pdf, separada de Deno.serve y de supabase-js para
// poder probarla con dependencias falsas (ver handler_test.ts).
//
// Esta función SOLO escribe en proposal_imports. Nunca en proposals.
import { runCoherenceChecks } from '../_shared/proposal-checks.ts';
import { computeDiff, type ProposalDiff, type ProposalSnapshot } from '../_shared/proposal-diff.ts';
import { hasUsefulContent, type Extraction, type StoredExtraction } from '../_shared/proposal-extraction.ts';
import { DEFAULT_MAX_PAGES, toBase64, UserError, validatePdf } from './pdf.ts';

export const MAX_CONCURRENT_PER_USER = 3;
export const MAX_PER_DAY_PER_USER = 30;
const DEFAULT_MODEL = 'claude-sonnet-5-5';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ImportRow {
  id: string;
  proposal_id: string | null;
  file_path: string;
  mode: 'new' | 'merge';
  status: string;
  created_by: string;
}

export interface Deps {
  env(name: string): string | undefined;
  /** Usuario del JWT, o null si el token no es válido. */
  getUser(token: string): Promise<{ id: string } | null>;
  /** Lee la fila con el cliente del usuario: si RLS no la devuelve, null. */
  getImportAsUser(token: string, importId: string): Promise<ImportRow | null>;
  /** Mismo criterio que proposals_update (can_manage_proposals + is_own_or_full). */
  canEditProposal(token: string, proposalId: string): Promise<boolean>;
  countProcessing(userId: string): Promise<number>;
  countSince(userId: string, sinceIso: string): Promise<number>;
  /** Update atómico a 'processing' si estaba en 'uploaded' o 'failed'; null si no. */
  lockImport(importId: string): Promise<ImportRow | null>;
  /** Dueño del objeto en storage.objects; null si el objeto no existe. */
  objectOwner(path: string): Promise<{ ownerId: string | null } | null>;
  download(path: string): Promise<Uint8Array | null>;
  getProposalSnapshot(proposalId: string): Promise<ProposalSnapshot | null>;
  extract(args: { pdfBase64: string; model: string; apiKey: string }): Promise<Extraction>;
  finishReady(importId: string, patch: { extracted: StoredExtraction; diff: ProposalDiff | null }): Promise<void>;
  finishFailed(importId: string, message: string): Promise<void>;
  runInBackground(task: Promise<unknown>): void;
  now(): Date;
  log(message: string, meta?: Record<string, unknown>): void;
}

const DEFAULT_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
];

function corsHeadersFor(req: Request, deps: Deps): Record<string, string> {
  const configured = deps.env('ALLOWED_ORIGINS');
  const allowed = configured ? configured.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_ORIGINS;
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export async function handleRequest(req: Request, deps: Deps): Promise<Response> {
  const cors = corsHeadersFor(req, deps);
  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Método no permitido.' }, 405);
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return json({ error: 'Falta el token de sesión.' }, 401);
    }
    const user = await deps.getUser(token);
    if (!user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const body = (await req.json().catch(() => null)) as { import_id?: unknown } | null;
    if (!body || typeof body.import_id !== 'string' || !UUID.test(body.import_id)) {
      return json({ error: 'Solicitud inválida.' }, 400);
    }

    // 1) Los permisos de lectura los decide la base (RLS), no la función.
    const row = await deps.getImportAsUser(token, body.import_id);
    if (!row) {
      return json({ error: 'No se encontró la importación.' }, 404);
    }

    // 2) Modo merge: el usuario todavía debe poder editar la propuesta.
    if (row.mode === 'merge') {
      if (!row.proposal_id || !(await deps.canEditProposal(token, row.proposal_id))) {
        return json({ error: 'Ya no tienes permiso para editar esta propuesta.' }, 403);
      }
    }

    // Límites de uso por usuario (antes del bloqueo, para no dejar la fila en 'processing').
    if ((await deps.countProcessing(row.created_by)) >= MAX_CONCURRENT_PER_USER) {
      return json({ error: `Ya tienes ${MAX_CONCURRENT_PER_USER} PDF procesándose. Espera a que termine alguno.` }, 429);
    }
    const since = new Date(deps.now().getTime() - 24 * 60 * 60 * 1000).toISOString();
    if ((await deps.countSince(row.created_by, since)) > MAX_PER_DAY_PER_USER) {
      return json({ error: `Llegaste al límite de ${MAX_PER_DAY_PER_USER} importaciones por día. Inténtalo mañana.` }, 429);
    }

    // 3) Bloqueo atómico contra doble proceso ('failed' permite reintentar).
    const locked = await deps.lockImport(row.id);
    if (!locked) {
      return json({ error: 'Esta importación ya se está procesando o ya se aplicó.' }, 409);
    }

    // 4) Responde 202 y sigue en segundo plano.
    deps.runInBackground(processImport(deps, locked));
    return json({ status: 'processing' }, 202);
  } catch (err) {
    deps.log('handler.unexpected_error', { error: (err as Error).message });
    return json({ error: 'No se pudo iniciar la importación. Inténtalo de nuevo.' }, 500);
  }
}

export async function processImport(deps: Deps, row: ImportRow): Promise<void> {
  const startedAt = deps.now().getTime();
  try {
    const apiKey = deps.env('ANTHROPIC_API_KEY');
    if (!apiKey) {
      throw new UserError('El asistente no está configurado todavía. Avisa al administrador.', 'falta ANTHROPIC_API_KEY');
    }
    const model = deps.env('ANTHROPIC_MODEL') || DEFAULT_MODEL;
    const maxPages = Number(deps.env('PDF_MAX_PAGES')) || DEFAULT_MAX_PAGES;

    // 5) El objeto existe y es de quien creó la importación.
    const object = await deps.objectOwner(row.file_path);
    if (!object) {
      throw new UserError('No se encontró el archivo subido. Vuelve a subirlo.', 'objeto inexistente');
    }
    if (!object.ownerId || object.ownerId.toLowerCase() !== row.created_by.toLowerCase()) {
      throw new UserError('No se pudo verificar el archivo subido. Vuelve a subirlo.', 'dueño del objeto distinto de created_by');
    }

    // 6) Descarga y validación del PDF.
    const bytes = await deps.download(row.file_path);
    if (!bytes) {
      throw new UserError('No se pudo descargar el archivo. Vuelve a subirlo.', 'descarga fallida');
    }
    const { pages } = validatePdf(bytes, maxPages);

    // 7) Extracción con el modelo.
    const extraction = await deps.extract({ pdfBase64: toBase64(bytes), model, apiKey });
    if (!hasUsefulContent(extraction)) {
      throw new UserError(
        'No se encontró información del viaje en el PDF. Si es un escaneo, revisa que se lea con claridad.',
        'extracción sin contenido útil'
      );
    }

    const stored: StoredExtraction = {
      ...extraction,
      warnings: runCoherenceChecks(extraction),
      meta: { model, extracted_at: deps.now().toISOString() }
    };

    let diff: ProposalDiff | null = null;
    if (row.mode === 'merge') {
      const snapshot = row.proposal_id ? await deps.getProposalSnapshot(row.proposal_id) : null;
      if (!snapshot) {
        throw new UserError('La propuesta ya no existe.', 'propuesta no encontrada');
      }
      diff = computeDiff(extraction, snapshot);
    }

    await deps.finishReady(row.id, { extracted: stored, diff });
    deps.log('import.ready', { importId: row.id, mode: row.mode, pages, ms: deps.now().getTime() - startedAt });
  } catch (err) {
    const message =
      err instanceof UserError ? err.message : 'No se pudo procesar el PDF. Inténtalo de nuevo en unos minutos.';
    // Detalle técnico solo al log, y sin contenido del PDF ni datos del cliente.
    deps.log('import.failed', {
      importId: row.id,
      mode: row.mode,
      reason: err instanceof UserError ? (err.technical ?? err.message) : `${(err as Error).name}: ${(err as Error).message}`
    });
    try {
      await deps.finishFailed(row.id, message);
    } catch (finishErr) {
      deps.log('import.finish_failed_error', { importId: row.id, error: (finishErr as Error).message });
    }
  }
}
