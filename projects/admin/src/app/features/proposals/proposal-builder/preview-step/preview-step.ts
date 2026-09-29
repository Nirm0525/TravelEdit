import { Component, OnInit, effect, inject, input, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { Proposal } from '../../../../core/models/proposal.model';
import { PROPOSAL_SERVICE_TYPE_LABEL } from '../../../../core/models/proposal-enums';

/**
 * Vista previa interna: lee la propuesta con el cliente autenticado normal
 * (RLS de staff, ver supabase/migrations/0029_proposals.sql) — nunca pasa
 * por el gate público (get_proposal_gate/verify_proposal_access), nunca
 * pide código de acceso. No es un renderer compartido con el sitio público
 * (apps separadas, ver nota en public-proposal.ts) — aproxima la misma
 * jerarquía editorial (cover/intro/itinerario/pricing/terms) dentro de los
 * tokens de diseño del admin.
 */
@Component({
  selector: 'app-preview-step',
  imports: [DatePipe, CurrencyPipe],
  templateUrl: './preview-step.html',
  styleUrl: './preview-step.css'
})
export class PreviewStep implements OnInit {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);

  readonly proposalId = input.required<string>();
  /** Se monta también como columna persistente (no solo página completa) —
   *  el shell la incrementa cada vez que cualquier paso guarda algo, para
   *  que la vista previa refleje ediciones hechas en otros tabs sin que
   *  esta instancia tenga que compartir estado con ellos. */
  readonly refreshTick = input<number>(0);
  readonly serviceTypeLabel = PROPOSAL_SERVICE_TYPE_LABEL;

  readonly proposal = signal<Proposal | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  // Ver el comentario equivalente en client-trip-step.ts — proposalId (input
  // required) no tiene valor todavía dentro del constructor, dispara NG0950.
  ngOnInit(): void {
    void this.load();
  }

  constructor() {
    let firstRun = true;
    effect(() => {
      this.refreshTick();
      if (firstRun) {
        // ngOnInit ya dispara la primera carga — evita duplicarla.
        firstRun = false;
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.proposal.set(await this.proposalsService.getById(this.proposalId()));
    } catch (error) {
      console.error('No se pudo cargar la vista previa.', error);
      this.loadError.set('No se pudo cargar la vista previa. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  imageUrl(path: string | null): string | null {
    return this.proposalImages.publicUrl(path);
  }
}
