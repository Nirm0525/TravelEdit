import { Component, effect, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';
import { LeadsService, SendProposalResult } from '../../../core/services/leads';
import { Lead } from '../../../core/models/lead.model';

@Component({
  selector: 'app-send-proposal-modal',
  imports: [ReactiveFormsModule, AdminModal],
  templateUrl: './send-proposal-modal.html',
  styleUrl: './send-proposal-modal.css'
})
export class SendProposalModal {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly leadsService = inject(LeadsService);

  readonly open = input(false);
  readonly lead = input<Lead | null>(null);

  readonly closed = output<void>();
  readonly sent = output<SendProposalResult>();

  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    subject: this.fb.control('', Validators.required),
    message: this.fb.control('', Validators.required)
  });

  constructor() {
    // Al reabrir el modal se precarga con la última propuesta enviada (si la
    // hay) para que reenviar sea "editar y confirmar" en vez de escribir de
    // cero — pero solo al abrir, nunca mientras está abierto, para no pisar
    // lo que el admin ya está escribiendo.
    effect(() => {
      if (!this.open()) {
        return;
      }
      this.error.set(null);
      const current = this.lead();
      this.form.reset({
        subject: current?.proposalSubject ?? '',
        message: current?.proposalMessage ?? ''
      });
    });
  }

  close(): void {
    if (this.sending()) {
      return;
    }
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.sending()) {
      return;
    }

    const current = this.lead();
    if (!current) {
      this.error.set('No se encontró la solicitud.');
      return;
    }
    if (!current.email) {
      this.error.set('Esta solicitud no tiene un correo válido.');
      return;
    }

    const subject = this.form.controls.subject.value.trim();
    const message = this.form.controls.message.value.trim();
    if (!subject) {
      this.error.set('El asunto es obligatorio.');
      return;
    }
    if (!message) {
      this.error.set('El mensaje es obligatorio.');
      return;
    }

    this.sending.set(true);
    this.error.set(null);
    try {
      const result = await this.leadsService.sendProposal(current.id, subject, message);
      this.sent.emit(result);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo enviar la propuesta.');
    } finally {
      this.sending.set(false);
    }
  }
}
