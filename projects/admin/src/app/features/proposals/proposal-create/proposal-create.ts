import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ProposalsService } from '../../../core/services/proposals';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';

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
      await this.router.navigate(['/proposals', proposal.id, 'edit']);
    } catch (err) {
      console.error('No se pudo crear la propuesta.', err);
      this.error.set('No se pudo crear la propuesta. Intenta de nuevo.');
    } finally {
      this.saving.set(false);
    }
  }
}
