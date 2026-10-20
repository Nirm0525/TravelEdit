import { Component, input, output } from '@angular/core';
import { ProposalDocument } from '../../../core/services/public-proposal';

/** "Boleto aéreo CM385.pdf" → "Boleto aéreo CM385": así lo lee el cliente. */
export function documentDisplayName(name: string): string {
  const stripped = name.replace(/\.(pdf|jpe?g|png|webp)$/i, '').trim();
  return stripped === '' ? name : stripped;
}

/**
 * Documentos de UN servicio en la propuesta privada (boleto, voucher, confirmación…). Solo recibe documentos que el
 * servidor ya marcó como visibles para este cliente; no sabe nada de rutas de Storage ni de metadata interna (el
 * tipo ProposalDocument solo trae id, nombre y tipo). Sin documentos no pinta nada.
 */
@Component({
  selector: 'app-proposal-service-documents',
  templateUrl: './proposal-service-documents.html',
  styleUrl: './proposal-service-documents.css'
})
export class ProposalServiceDocuments {
  readonly documents = input<ProposalDocument[]>([]);
  /** Id del documento que se está abriendo (bloquea ese enlace mientras se pide la URL). */
  readonly busyId = input<string | null>(null);
  readonly openDocument = output<ProposalDocument>();

  readonly displayName = documentDisplayName;
}
