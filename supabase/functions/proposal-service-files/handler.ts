// Documentos adjuntos por servicio — lado ADMIN. Lógica separada de Deno.serve y de supabase-js para probarla
// con dependencias falsas (mismo criterio que apply-proposal-import).
//
// Entrada: POST { action, ... } con el JWT del usuario. Acciones:
//   prepare-upload    pide permiso para subir (valida todo y devuelve una URL firmada de subida a una ruta
//                     generada AQUÍ; el navegador sube directo a Storage, nunca elige la ruta).
//   finalize-upload   comprueba el objeto subido (existe, tamaño, tipo real por magic bytes) y crea la fila; si algo
//                     falla, borra el objeto y no crea metadata. Con replaceAttachmentId reemplaza sin perder el
//                     archivo anterior hasta que el nuevo está validado.
//   set-visibility    marca un documento como visible (o no) para el cliente.
//   delete            borra el objeto y luego la fila (reintentable).
//   sign              URL firmada de lectura de corta vida (admin).
//   remove-service /  quitan un servicio / un día del contenido en el servidor (sobre el contenido ACTUAL de la
//   remove-day        base, no el de una pestaña vieja) y purgan sus documentos; exigen confirmación si hay adjuntos.
//   purge-proposal    borra todos los documentos de una propuesta (solo admin) antes de eliminarla.
//
// Sirve a Propuestas Y a Itinerarios (mismo bucket y tabla; el tipo lo decide proposals.kind, nunca el cuerpo de la solicitud).
// Autorización: JWT válido + el registro es visible para ESE usuario (RLS de proposals) + es suyo (is_own_or_full: admin/editor
// cualquiera, la Asesora solo lo suyo) + can_travel(kind, 'gestionar_documentos'). Solo después se escribe con service_role.
// Los permisos NO se mezclan: lo que se puede hacer con un itinerario se decide con 'itinerary', no con 'proposal'. Para los
// adjuntos se parte de la fila y se exige el mismo alcance sobre su registro. Eliminar todos los documentos de un registro
// (purge-proposal) exige además can_travel(kind, 'eliminar').
import { corsHeadersFor } from '../_shared/cors.ts';
import type { InspectResult } from '../_shared/object-inspect.ts';
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_SERVICE,
  RULE_MESSAGES,
  SIGNED_URL_TTL_SECONDS,
  SNIFF_BYTES,
  KINDS,
  buildStoragePath,
  isSafeServiceId,
  isUuid,
  parseStoragePath,
  sanitizeDisplayName,
  serviceExists,
  serviceIdsOfDay,
  sniffKind,
  validateUploadRequest,
  withoutDay,
  withoutService
} from '../_shared/service-attachment-rules.ts';

export interface AttachmentRow {
  id: string;
  proposal_id: string;
  service_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  visible_to_client: boolean;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

/** Lo que el admin recibe: nunca la ruta de Storage. */
export interface AttachmentView {
  id: string;
  proposalId: string;
  serviceId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  visibleToClient: boolean;
  createdAt: string;
  updatedAt: string;
}

export const toView = (row: AttachmentRow): AttachmentView => ({
  id: row.id,
  proposalId: row.proposal_id,
  serviceId: row.service_id,
  fileName: row.file_name,
  mimeType: row.mime_type,
  fileSize: Number(row.file_size),
  visibleToClient: row.visible_to_client,
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

export type TravelKind = 'proposal' | 'itinerary';

export interface ProposalForUser {
  id: string;
  content: unknown;
  updated_at: string;
  /** Tipo del registro (proposals.kind): decide qué permiso aplica. */
  kind: TravelKind;
  advisor_id: string | null;
}

export type InsertResult = { row: AttachmentRow } | { error: 'duplicate_path' | 'service_not_found' | 'too_many_files' };

export interface Deps {
  env(name: string): string | undefined;
  getUser(token: string): Promise<{ id: string } | null>;
  /** public.can_travel(kind, action) con el cliente del USUARIO (rol real en la base; desconocido = false). */
  canTravel(token: string, kind: string, action: string): Promise<boolean>;
  /** public.is_own_or_full(advisor_id) con el cliente del USUARIO: admin/editor cualquiera, la Asesora solo lo suyo. */
  isOwnOrFull(token: string, advisorId: string | null): Promise<boolean>;
  /** Lee la propuesta con el cliente del USUARIO: si RLS no la devuelve, null. */
  getProposalAsUser(token: string, proposalId: string): Promise<ProposalForUser | null>;
  /** Actualiza proposals.content con el cliente del usuario solo si updated_at sigue siendo el leído (null = cambió). */
  updateContentAsUser(token: string, proposalId: string, expectedUpdatedAt: string, content: unknown): Promise<ProposalForUser | null>;

  getAttachment(id: string): Promise<AttachmentRow | null>;
  findByPath(path: string): Promise<AttachmentRow | null>;
  listForServices(proposalId: string, serviceIds: string[]): Promise<AttachmentRow[]>;
  listForProposal(proposalId: string): Promise<AttachmentRow[]>;
  insertAttachment(row: Omit<AttachmentRow, 'id' | 'created_at' | 'updated_at'>): Promise<InsertResult>;
  /** Cambia el archivo de una fila solo si su storage_path sigue siendo `expectedPath` (null = cambió o no existe). */
  replaceFile(id: string, expectedPath: string, patch: { file_name: string; storage_path: string; mime_type: string; file_size: number }): Promise<AttachmentRow | null>;
  setVisible(id: string, visible: boolean): Promise<AttachmentRow | null>;
  deleteRow(id: string): Promise<void>;

  createSignedUploadUrl(path: string): Promise<{ token: string; signedUrl: string }>;
  /**
   * Tamaño REAL del objeto (el que informa Storage, no el que declaró el navegador) y sus primeros bytes, en una sola
   * petición Range sobre una URL firmada. 'missing' si no existe; 'error' si no se pudo verificar con certeza.
   */
  inspectObject(path: string, headBytes: number): Promise<InspectResult>;
  /** Borra el objeto; que no exista cuenta como éxito. Lanza si Storage falla. */
  removeObject(path: string): Promise<void>;
  createSignedUrl(path: string, ttlSeconds: number, downloadName?: string): Promise<string>;
  log(message: string, meta?: Record<string, unknown>): void;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

type Body = Record<string, unknown>;

const NOT_FOUND_PROPOSAL = new HttpError(404, 'not_found', 'No se encontró la propuesta.');
const NOT_FOUND_ATTACHMENT = new HttpError(404, 'not_found', 'No se encontró el documento.');

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
      return json({ error: 'Falta el token de sesión.', code: 'unauthorized' }, 401);
    }
    const user = await deps.getUser(token);
    if (!user) {
      return json({ error: 'Sesión inválida.', code: 'unauthorized' }, 401);
    }
    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body || typeof body !== 'object' || typeof body.action !== 'string') {
      return json({ error: 'Solicitud inválida.', code: 'bad_request' }, 400);
    }
    const ctx: Ctx = { deps, token, userId: user.id };
    switch (body.action) {
      case 'prepare-upload':
        return json(await prepareUpload(ctx, body), 200);
      case 'finalize-upload':
        return json(await finalizeUpload(ctx, body), 200);
      case 'set-visibility':
        return json(await setVisibility(ctx, body), 200);
      case 'delete':
        return json(await deleteAttachment(ctx, body), 200);
      case 'sign':
        return json(await sign(ctx, body), 200);
      case 'remove-service':
        return json(await removeItem(ctx, body, 'service'), 200);
      case 'remove-day':
        return json(await removeItem(ctx, body, 'day'), 200);
      case 'purge-proposal':
        return json(await purgeProposal(ctx, body), 200);
      default:
        return json({ error: 'Acción desconocida.', code: 'bad_request' }, 400);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return json({ error: err.message, code: err.code, ...err.extra }, err.status);
    }
    deps.log('files.unexpected_error', { error: (err as Error).message });
    return json({ error: 'No se pudo completar la operación. Inténtalo de nuevo.', code: 'internal' }, 500);
  }
}

interface Ctx {
  deps: Deps;
  token: string;
  userId: string;
}

// ---------------------------------------------------------------- utilidades

function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new HttpError(400, 'bad_request', `Solicitud inválida (${field}).`);
  }
  return value.toLowerCase();
}

function requireServiceId(value: unknown): string {
  if (!isSafeServiceId(value)) {
    throw new HttpError(400, 'bad_request', 'Solicitud inválida (serviceId).');
  }
  return value;
}

/**
 * Alcance real: el registro debe ser visible para ESTE usuario (RLS) y suyo (is_own_or_full); si no, 404 (no se revela si
 * existe). Con el registro a la vista, su TIPO decide el permiso: can_travel(kind, action) o 403.
 */
async function requireProposal(ctx: Ctx, proposalId: string, action = 'gestionar_documentos'): Promise<ProposalForUser> {
  const proposal = await ctx.deps.getProposalAsUser(ctx.token, proposalId);
  if (!proposal || !(await ctx.deps.isOwnOrFull(ctx.token, proposal.advisor_id))) {
    throw NOT_FOUND_PROPOSAL;
  }
  if (!(await ctx.deps.canTravel(ctx.token, proposal.kind, action))) {
    throw new HttpError(403, 'forbidden', 'No tienes permiso para gestionar los documentos de este viaje.');
  }
  return proposal;
}

/** Fila + alcance sobre su propuesta. */
async function requireAttachment(ctx: Ctx, attachmentId: unknown): Promise<{ row: AttachmentRow; proposal: ProposalForUser }> {
  const id = requireUuid(attachmentId, 'attachmentId');
  const row = await ctx.deps.getAttachment(id);
  if (!row) {
    throw NOT_FOUND_ATTACHMENT;
  }
  // Mismo alcance que sobre el registro (visible, propio y permiso por tipo); para el adjunto, ajeno = 404.
  let proposal: ProposalForUser;
  try {
    proposal = await requireProposal(ctx, row.proposal_id);
  } catch (err) {
    throw err instanceof HttpError && err.status === 404 ? NOT_FOUND_ATTACHMENT : err;
  }
  return { row, proposal };
}

/** Borra el objeto y luego la fila. Si Storage falla se detiene (la fila queda: nada de referencias rotas ni archivos invisibles). */
async function purgeRow(deps: Deps, row: AttachmentRow): Promise<void> {
  await deps.removeObject(row.storage_path);
  await deps.deleteRow(row.id);
}

/** Intenta borrar un objeto recién subido que no se aceptó; un fallo se registra (no hay fila que lo apunte). */
async function discardObject(deps: Deps, path: string): Promise<void> {
  try {
    await deps.removeObject(path);
  } catch (err) {
    deps.log('files.discard_failed', { error: (err as Error).message });
  }
}

// ---------------------------------------------------------------- subida

async function prepareUpload(ctx: Ctx, body: Body) {
  const proposalId = requireUuid(body.proposalId, 'proposalId');
  const serviceId = requireServiceId(body.serviceId);
  // Antes de autorizar nada: tipo, extensión y tamaño declarados.
  const checked = validateUploadRequest({ fileName: body.fileName, mimeType: body.mimeType, fileSize: body.fileSize });
  if (!checked.ok) {
    throw new HttpError(400, checked.error, RULE_MESSAGES[checked.error]);
  }
  const replaceId = body.replaceAttachmentId === undefined || body.replaceAttachmentId === null ? null : requireUuid(body.replaceAttachmentId, 'replaceAttachmentId');

  const proposal = await requireProposal(ctx, proposalId);
  if (!serviceExists(proposal.content, serviceId)) {
    throw new HttpError(404, 'service_not_found', 'Ese servicio no pertenece a esta propuesta.');
  }

  if (replaceId) {
    const current = await ctx.deps.getAttachment(replaceId);
    if (!current || current.proposal_id !== proposalId || current.service_id !== serviceId) {
      throw NOT_FOUND_ATTACHMENT;
    }
  } else {
    const existing = await ctx.deps.listForServices(proposalId, [serviceId]);
    if (existing.length >= MAX_FILES_PER_SERVICE) {
      throw new HttpError(409, 'too_many_files', `Cada servicio admite hasta ${MAX_FILES_PER_SERVICE} documentos.`);
    }
  }

  const storagePath = buildStoragePath(proposalId, serviceId, checked.kind);
  const signed = await ctx.deps.createSignedUploadUrl(storagePath);
  return { storagePath, token: signed.token, signedUrl: signed.signedUrl, contentType: KINDS[checked.kind].mime, maxBytes: MAX_FILE_BYTES };
}

async function finalizeUpload(ctx: Ctx, body: Body) {
  const { deps } = ctx;
  const proposalId = requireUuid(body.proposalId, 'proposalId');
  const serviceId = requireServiceId(body.serviceId);
  const replaceId = body.replaceAttachmentId === undefined || body.replaceAttachmentId === null ? null : requireUuid(body.replaceAttachmentId, 'replaceAttachmentId');

  // La ruta debe ser de una propuesta y un servicio EXACTOS: la del cuerpo. Una ruta ajena se rechaza sin tocar el objeto.
  const parsed = parseStoragePath(body.storagePath);
  if (!parsed || parsed.proposalId !== proposalId || parsed.serviceId !== serviceId) {
    throw new HttpError(400, 'invalid_path', 'La ruta del archivo no corresponde a este servicio.');
  }
  const storagePath = body.storagePath as string;

  const proposal = await requireProposal(ctx, proposalId);
  if (!serviceExists(proposal.content, serviceId)) {
    throw new HttpError(404, 'service_not_found', 'Ese servicio no pertenece a esta propuesta.');
  }

  // Doble finalize: si la ruta ya tiene fila, es la misma operación (no se duplica nada).
  const already = await deps.findByPath(storagePath);
  if (already) {
    if (already.proposal_id !== proposalId || already.service_id !== serviceId) {
      throw new HttpError(400, 'invalid_path', 'La ruta del archivo no corresponde a este servicio.');
    }
    return { attachment: toView(already) };
  }

  // A partir de aquí la ruta es de este servicio: cualquier fallo borra el objeto y no deja metadata.
  const inspected = await deps.inspectObject(storagePath, SNIFF_BYTES);
  if (inspected.status === 'missing') {
    throw new HttpError(404, 'object_missing', 'No se encontró el archivo subido. Vuelve a intentarlo.');
  }
  if (inspected.status === 'error') {
    // No se pudo verificar (Storage o red): NO se borra nada, el archivo puede ser válido y el cliente puede reintentar finalize.
    deps.log('files.inspect_failed', { reason: inspected.reason });
    throw new HttpError(502, 'inspect_failed', 'No se pudo verificar el archivo subido. Inténtalo de nuevo.');
  }
  const { size, head } = inspected;
  const fail = async (status: number, code: string, message: string): Promise<never> => {
    await discardObject(deps, storagePath);
    throw new HttpError(status, code, message);
  };
  if (size === 0) {
    return await fail(400, 'empty_file', RULE_MESSAGES.empty_file);
  }
  if (size > MAX_FILE_BYTES) {
    return await fail(400, 'too_large', RULE_MESSAGES.too_large);
  }
  const real = sniffKind(head);
  if (real !== parsed.kind) {
    return await fail(400, 'invalid_file_type', 'El contenido del archivo no coincide con su tipo. Usa un PDF, JPEG, PNG o WebP válido.');
  }
  const fileName = sanitizeDisplayName(body.fileName, real);

  if (replaceId) {
    const current = await deps.getAttachment(replaceId);
    if (!current || current.proposal_id !== proposalId || current.service_id !== serviceId) {
      return await fail(404, 'not_found', 'No se encontró el documento a reemplazar.');
    }
    const oldPath = current.storage_path;
    const updated = await deps.replaceFile(current.id, oldPath, {
      file_name: fileName,
      storage_path: storagePath,
      mime_type: KINDS[real].mime,
      file_size: size
    });
    if (!updated) {
      return await fail(409, 'conflict', 'El documento cambió mientras se subía el reemplazo. Inténtalo de nuevo.');
    }
    // El nuevo ya está validado y apuntado: recién ahora se retira el anterior (si falla queda un huérfano registrado).
    try {
      await deps.removeObject(oldPath);
    } catch (err) {
      deps.log('files.replace_old_object_leaked', { attachmentId: current.id, error: (err as Error).message });
    }
    return { attachment: toView(updated) };
  }

  const inserted = await deps.insertAttachment({
    proposal_id: proposalId,
    service_id: serviceId,
    file_name: fileName,
    storage_path: storagePath,
    mime_type: KINDS[real].mime,
    file_size: size,
    visible_to_client: false,
    created_by: ctx.userId
  });
  if ('error' in inserted) {
    if (inserted.error === 'duplicate_path') {
      // Otra llamada finalizó la misma ruta a la vez: el objeto es el de esa fila, no se borra.
      const winner = await deps.findByPath(storagePath);
      if (winner) {
        return { attachment: toView(winner) };
      }
    }
    return await fail(
      inserted.error === 'too_many_files' ? 409 : 404,
      inserted.error,
      inserted.error === 'too_many_files'
        ? `Cada servicio admite hasta ${MAX_FILES_PER_SERVICE} documentos.`
        : 'Ese servicio no pertenece a esta propuesta.'
    );
  }
  return { attachment: toView(inserted.row) };
}

// ---------------------------------------------------------------- operaciones sobre un documento

async function setVisibility(ctx: Ctx, body: Body) {
  if (typeof body.visible !== 'boolean') {
    throw new HttpError(400, 'bad_request', 'Solicitud inválida (visible).');
  }
  const { row } = await requireAttachment(ctx, body.attachmentId);
  const updated = await ctx.deps.setVisible(row.id, body.visible);
  if (!updated) {
    throw NOT_FOUND_ATTACHMENT;
  }
  return { attachment: toView(updated) };
}

async function deleteAttachment(ctx: Ctx, body: Body) {
  const { row } = await requireAttachment(ctx, body.attachmentId);
  try {
    await purgeRow(ctx.deps, row);
  } catch (err) {
    ctx.deps.log('files.delete_failed', { attachmentId: row.id, error: (err as Error).message });
    throw new HttpError(502, 'storage_failed', 'No se pudo eliminar el archivo. El documento sigue en la lista: inténtalo de nuevo.');
  }
  return { deleted: true };
}

async function sign(ctx: Ctx, body: Body) {
  const { row } = await requireAttachment(ctx, body.attachmentId);
  const url = await ctx.deps.createSignedUrl(row.storage_path, SIGNED_URL_TTL_SECONDS, body.download === true ? row.file_name : undefined);
  return { url, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
}

// ---------------------------------------------------------------- borrar un servicio / un día con documentos

const CONTENT_RETRIES = 3;

/**
 * Orden: (1) validar usuario, alcance y pertenencia; (2) contar adjuntos y exigir confirmación; (3) purgar objetos y
 * filas (cada documento: Storage y luego fila; si Storage falla se detiene SIN tocar el contenido); (4) quitar el
 * servicio/día del contenido ACTUAL de la base con bloqueo optimista por updated_at (nunca el de una pestaña vieja);
 * (5) barrer adjuntos que hayan entrado entre medias (el trigger de la base ya impide nuevos al quitarse el servicio).
 * Así nunca quedan documentos huérfanos tras un fallo: lo peor que puede pasar es un servicio vivo con menos documentos,
 * y repetir la operación lo resuelve.
 */
async function removeItem(ctx: Ctx, body: Body, kind: 'service' | 'day') {
  const { deps } = ctx;
  const proposalId = requireUuid(body.proposalId, 'proposalId');
  const serviceId = kind === 'service' ? requireServiceId(body.serviceId) : null;
  const dayId = typeof body.dayId === 'string' && body.dayId !== '' ? body.dayId : null;
  if (kind === 'day' && !dayId) {
    throw new HttpError(400, 'bad_request', 'Solicitud inválida (dayId).');
  }
  const confirm = body.confirm === true;
  const expectedCount = typeof body.expectedCount === 'number' ? body.expectedCount : null;

  let proposal = await requireProposal(ctx, proposalId);
  if (!proposal.content || typeof proposal.content !== 'object' || Array.isArray(proposal.content)) {
    throw new HttpError(422, 'invalid_content', 'El contenido de la propuesta no es válido.');
  }

  // Ids de servicio afectados: SOLO los de este servicio / día, dentro de ESTA propuesta.
  let serviceIds: string[];
  if (kind === 'service') {
    if (!serviceExists(proposal.content, serviceId!, dayId ?? undefined)) {
      throw new HttpError(404, 'service_not_found', 'Ese servicio no pertenece a esta propuesta.');
    }
    serviceIds = [serviceId!];
  } else {
    const ids = serviceIdsOfDay(proposal.content, dayId!);
    if (!ids) {
      throw new HttpError(404, 'day_not_found', 'Ese día no pertenece a esta propuesta.');
    }
    serviceIds = ids;
  }

  const attachments = serviceIds.length > 0 ? await deps.listForServices(proposalId, serviceIds) : [];
  if (attachments.length > 0) {
    if (!confirm) {
      throw new HttpError(409, 'confirmation_required', 'Hay documentos adjuntos: confirma que quieres eliminarlos.', { attachmentCount: attachments.length });
    }
    if (expectedCount !== attachments.length) {
      throw new HttpError(409, 'count_changed', 'Los documentos adjuntos cambiaron: revisa y confirma de nuevo.', { attachmentCount: attachments.length });
    }
  }

  let purged = 0;
  for (const row of attachments) {
    try {
      await purgeRow(deps, row);
      purged += 1;
    } catch (err) {
      deps.log('files.purge_failed', { attachmentId: row.id, error: (err as Error).message });
      throw new HttpError(502, 'storage_failed', 'No se pudieron eliminar todos los documentos. Nada más se modificó: inténtalo de nuevo.', {
        purged,
        remaining: attachments.length - purged
      });
    }
  }

  // Contenido: se parte del contenido ACTUAL de la base y se reintenta si otra escritura se adelantó.
  let content = proposal.content as Record<string, unknown>;
  for (let attempt = 0; attempt < CONTENT_RETRIES; attempt++) {
    const stillThere = kind === 'service' ? serviceExists(content, serviceId!, dayId ?? undefined) : serviceIdsOfDay(content, dayId!) !== null;
    if (!stillThere) {
      break; // ya no está (otra operación lo quitó): nada más que hacer
    }
    const next = kind === 'service' ? withoutService(content, serviceId!) : withoutDay(content, dayId!);
    const updated = await deps.updateContentAsUser(ctx.token, proposalId, proposal.updated_at, next);
    if (updated) {
      content = updated.content as Record<string, unknown>;
      proposal = updated;
      break;
    }
    const fresh = await requireProposal(ctx, proposalId);
    content = fresh.content as Record<string, unknown>;
    proposal = fresh;
    if (attempt === CONTENT_RETRIES - 1) {
      throw new HttpError(409, 'content_conflict', 'La propuesta cambió mientras se eliminaba. Recarga e inténtalo de nuevo.');
    }
  }

  // Barrido final: lo que haya entrado entre la purga y la baja del servicio.
  let extra = 0;
  try {
    for (const row of await deps.listForServices(proposalId, serviceIds)) {
      await purgeRow(deps, row);
      extra += 1;
    }
  } catch (err) {
    deps.log('files.sweep_failed', { error: (err as Error).message });
  }

  return { content, deletedDocuments: purged + extra };
}

// ---------------------------------------------------------------- eliminar una propuesta

async function purgeProposal(ctx: Ctx, body: Body) {
  const proposalId = requireUuid(body.proposalId, 'proposalId');
  // Solo quien puede ELIMINAR ese tipo de registro (can_travel(kind, 'eliminar'): hoy solo admin, policy proposals_delete);
  // si no, no se purga nada.
  const proposal = await requireProposal(ctx, proposalId);
  if (!(await ctx.deps.canTravel(ctx.token, proposal.kind, 'eliminar'))) {
    throw new HttpError(403, 'forbidden', 'Solo un administrador puede eliminar este registro.');
  }
  const rows = await ctx.deps.listForProposal(proposalId);
  let purged = 0;
  for (const row of rows) {
    try {
      await purgeRow(ctx.deps, row);
      purged += 1;
    } catch (err) {
      ctx.deps.log('files.purge_proposal_failed', { attachmentId: row.id, error: (err as Error).message });
      throw new HttpError(502, 'storage_failed', 'No se pudieron eliminar todos los documentos. La propuesta no se eliminó: inténtalo de nuevo.', {
        purged,
        remaining: rows.length - purged
      });
    }
  }
  return { deletedDocuments: purged };
}
