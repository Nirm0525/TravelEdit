import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import {
  AttachmentApiError,
  ProposalServiceAttachment,
  UploadPhase
} from '../models/proposal-service-attachment.model';
import { ProposalContent, toProposalContent } from '../models/proposal.model';
import { validateAttachmentFile } from '../utils/service-attachments';

const BUCKET = 'proposal-service-files';
const FUNCTION = 'proposal-service-files';
// Sin storage_path: el admin no necesita (ni debe manejar) la ruta de Storage.
const COLUMNS = 'id, proposal_id, service_id, file_name, mime_type, file_size, visible_to_client, created_at, updated_at';

interface AttachmentRowShape {
  id: string;
  proposal_id: string;
  service_id: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  visible_to_client: boolean;
  created_at: string;
  updated_at: string;
}

function fromRow(row: AttachmentRowShape): ProposalServiceAttachment {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    serviceId: row.service_id,
    fileName: row.file_name,
    mimeType: row.mime_type,
    fileSize: Number(row.file_size),
    visibleToClient: row.visible_to_client === true,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Lo que devuelve la Edge Function (ya sin la ruta de Storage). */
interface AttachmentView {
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

export interface RemovalOutcome {
  content: ProposalContent;
  deletedDocuments: number;
}

/**
 * Documentos adjuntos por servicio. Listar usa RLS directamente (solo lectura); todo lo demás pasa por la Edge
 * Function proposal-service-files, que valida usuario, alcance de la propuesta y pertenencia del servicio. Los archivos
 * se suben DIRECTO a Storage con una URL firmada que genera el servidor (el navegador nunca elige la ruta).
 */
@Injectable({ providedIn: 'root' })
export class ProposalServiceAttachmentsService {
  private readonly supabase = inject(SupabaseService);

  /** Todos los documentos de la propuesta (uno por consulta; el editor los reparte por servicio). */
  async listForProposal(proposalId: string): Promise<ProposalServiceAttachment[]> {
    const { data, error } = await this.supabase.client
      .from('proposal_service_attachments')
      .select(COLUMNS)
      .eq('proposal_id', proposalId)
      .order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    return ((data ?? []) as unknown as AttachmentRowShape[]).map(fromRow);
  }

  /**
   * Sube (o reemplaza, con replaceId) un archivo: 1) pide autorización y una ruta al servidor, 2) sube directo a
   * Storage, 3) finaliza (el servidor comprueba existencia, tamaño y tipo real). Si el reemplazo falla, el archivo
   * anterior sigue intacto.
   */
  async upload(
    proposalId: string,
    serviceId: string,
    file: File,
    options: { replaceId?: string; onPhase?: (phase: UploadPhase) => void } = {}
  ): Promise<ProposalServiceAttachment> {
    const invalid = validateAttachmentFile(file);
    if (invalid) {
      throw new AttachmentApiError(invalid, 'invalid_file');
    }

    options.onPhase?.('authorizing');
    const prepared = await this.call<{ storagePath: string; token: string; contentType: string }>({
      action: 'prepare-upload',
      proposalId,
      serviceId,
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      replaceAttachmentId: options.replaceId
    });

    options.onPhase?.('uploading');
    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .uploadToSignedUrl(prepared.storagePath, prepared.token, file, { contentType: prepared.contentType, upsert: false });
    if (error) {
      console.error('No se pudo subir el documento.', error);
      throw new AttachmentApiError('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.', 'upload_failed');
    }

    options.onPhase?.('finalizing');
    const done = await this.call<{ attachment: AttachmentView }>({
      action: 'finalize-upload',
      proposalId,
      serviceId,
      storagePath: prepared.storagePath,
      fileName: file.name,
      replaceAttachmentId: options.replaceId
    });
    return done.attachment;
  }

  async setVisibility(attachmentId: string, visible: boolean): Promise<ProposalServiceAttachment> {
    const res = await this.call<{ attachment: AttachmentView }>({ action: 'set-visibility', attachmentId, visible });
    return res.attachment;
  }

  async delete(attachmentId: string): Promise<void> {
    await this.call<{ deleted: boolean }>({ action: 'delete', attachmentId });
  }

  /** URL firmada de lectura (10 minutos); se pide al hacer clic, nunca se guarda. */
  async getUrl(attachmentId: string, download = false): Promise<string> {
    const res = await this.call<{ url: string }>({ action: 'sign', attachmentId, download });
    return res.url;
  }

  /**
   * Quita un servicio del contenido EN EL SERVIDOR (sobre el contenido actual de la base) y purga sus documentos.
   * Si tiene documentos y no se confirmó, lanza AttachmentApiError con code 'confirmation_required' (y attachmentCount).
   */
  async removeService(
    proposalId: string,
    dayId: string,
    serviceId: string,
    confirmation?: { expectedCount: number }
  ): Promise<RemovalOutcome> {
    return this.remove({ action: 'remove-service', proposalId, dayId, serviceId }, confirmation);
  }

  async removeDay(proposalId: string, dayId: string, confirmation?: { expectedCount: number }): Promise<RemovalOutcome> {
    return this.remove({ action: 'remove-day', proposalId, dayId }, confirmation);
  }

  /** Borra todos los documentos de una propuesta (solo admin) antes de eliminarla. Si falla, la propuesta no debe borrarse. */
  async purgeProposal(proposalId: string): Promise<void> {
    await this.call<{ deletedDocuments: number }>({ action: 'purge-proposal', proposalId });
  }

  private async remove(body: Record<string, unknown>, confirmation?: { expectedCount: number }): Promise<RemovalOutcome> {
    const res = await this.call<{ content: unknown; deletedDocuments: number }>({
      ...body,
      confirm: confirmation !== undefined,
      expectedCount: confirmation?.expectedCount
    });
    return { content: toProposalContent(res.content), deletedDocuments: res.deletedDocuments };
  }

  private async call<T>(body: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.supabase.client.functions.invoke<T & { error?: string; code?: string }>(FUNCTION, { body });
    if (error) {
      throw await this.toApiError(error);
    }
    if (!data || (data as { error?: string }).error) {
      throw new AttachmentApiError((data as { error?: string } | null)?.error ?? 'No se pudo completar la operación.', 'unknown');
    }
    return data;
  }

  private async toApiError(error: unknown): Promise<AttachmentApiError> {
    const context = (error as { context?: Response })?.context;
    if (context && typeof context.json === 'function') {
      try {
        const { error: message, code, ...extra } = (await context.json()) as { error?: string; code?: string; [key: string]: unknown };
        return new AttachmentApiError(message ?? 'No se pudo completar la operación.', code ?? 'unknown', extra);
      } catch {
        // cuerpo no JSON: se cae al mensaje genérico
      }
    }
    return new AttachmentApiError('No se pudo completar la operación. Revisa tu conexión e inténtalo de nuevo.', 'network');
  }
}
