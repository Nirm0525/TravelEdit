import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProposalsService } from '../../../core/services/proposals';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { injectTravelMode, travelConfigOf, travelPaths } from '../../travel/travel-config';

@Component({
  selector: 'app-proposal-create',
  imports: [ReactiveFormsModule, RouterLink, AdminPageHeader],
  templateUrl: './proposal-create.html',
  styleUrl: './proposal-create.css'
})
export class ProposalCreate {
  private readonly proposalsService = inject(ProposalsService);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);

  /** Propuesta o Itinerario según la ruta (features/travel). */
  readonly mode = injectTravelMode();
  readonly config = travelConfigOf(this.mode);
  readonly labels = this.config.labels;
  readonly listPath = travelPaths.list(this.mode);
  readonly breadcrumb = [
    { label: 'Panel', link: '/dashboard' },
    { label: 'Viajes' },
    { label: this.labels.plural, link: this.listPath },
    { label: this.labels.createTitle }
  ];

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    clientName: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    destinationText: this.fb.control('', { nonNullable: true })
  });

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      const raw = this.form.getRawValue();
      const proposal = await this.proposalsService.createDraft({
        clientName: raw.clientName,
        destinationText: raw.destinationText || undefined
      });
      await this.router.navigate(travelPaths.edit(this.mode, proposal.id));
    } catch (err) {
      console.error('No se pudo crear la propuesta.', err);
      this.error.set(`No se pudo crear la ${this.labels.singular}. Intenta de nuevo.`);
    } finally {
      this.saving.set(false);
    }
  }
}
