/**
 * Documento adjunto a un servicio del itinerario (boleto, voucher, confirmación…). La metadata vive en
 * public.proposal_service_attachments y el archivo en un bucket privado (migración 0054); NUNCA dentro de
 * ProposalContent. El admin no ve la ruta de Storage: abre los archivos con una URL firmada de corta vida.
 */
export interface ProposalServiceAttachment {
  id: string;
  proposalId: string;
  /** Id del servicio dentro de content.days[].services[] (estable: se genera una vez y no cambia). */
  serviceId: string;
  /** Nombre original, solo para mostrar. */
  fileName: string;
  mimeType: string;
  fileSize: number;
  /** Seguridad por defecto: un documento nuevo es interno hasta que se marque como visible. */
  visibleToClient: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Error de las Edge Functions de documentos, con el código que devuelven (confirmation_required, too_many_files…). */
export class AttachmentApiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly extra: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = 'AttachmentApiError';
  }

  /** Cuántos documentos hay que confirmar borrar (códigos confirmation_required y count_changed). */
  get attachmentCount(): number {
    return typeof this.extra['attachmentCount'] === 'number' ? (this.extra['attachmentCount'] as number) : 0;
  }
}

export type UploadPhase = 'authorizing' | 'uploading' | 'finalizing';
