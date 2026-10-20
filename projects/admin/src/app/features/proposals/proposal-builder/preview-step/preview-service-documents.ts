import { Component, input, output } from '@angular/core';
import { ProposalServiceAttachment } from '../../../../core/models/proposal-service-attachment.model';
import { displayNameWithoutExtension, formatFileSize } from '../../../../core/utils/service-attachments';

/**
 * Documentos de UN servicio en la vista previa interna. Muestra todos (a diferencia de la propuesta real, que solo muestra
 * los visibles) y, en cada uno, si lo ve el cliente o es solo interno. No pide URLs: avisa con `open` y lo resuelve el padre.
 */
@Component({
  selector: 'app-preview-service-documents',
  templateUrl: './preview-service-documents.html',
  styleUrl: './preview-service-documents.css'
})
export class PreviewServiceDocuments {
  readonly documents = input<ProposalServiceAttachment[]>([]);
  readonly openingId = input<string | null>(null);
  readonly error = input<string | null>(null);
  readonly open = output<ProposalServiceAttachment>();

  readonly name = (a: ProposalServiceAttachment) => displayNameWithoutExtension(a.fileName);
  readonly isImage = (a: ProposalServiceAttachment) => a.mimeType.startsWith('image/');
  readonly meta = (a: ProposalServiceAttachment) => `${this.isImage(a) ? 'Imagen' : 'PDF'} · ${formatFileSize(a.fileSize)}`;
}
