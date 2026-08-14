import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { NewsletterService } from '../../core/services/newsletter';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';

type SubmitState = 'idle' | 'loading' | 'ok' | 'invalid' | 'duplicate' | 'error';

@Component({
  selector: 'app-footer',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './footer.html',
  styleUrl: './footer.css'
})
export class Footer {
  private readonly newsletter = inject(NewsletterService);
  private readonly emailInput = viewChild<ElementRef<HTMLInputElement>>('emailInput');

  readonly state = signal<SubmitState>('idle');
  readonly year = new Date(2026, 0, 1).getFullYear();

  readonly message: Record<SubmitState, string> = {
    idle: '',
    loading: '',
    ok: '¡Gracias! Ya estás suscrita/o.',
    invalid: 'Ingresa un email válido.',
    duplicate: 'Ese email ya está suscrito.',
    error: 'Algo salió mal. Intenta de nuevo.'
  };

  async onSubmit(event: Event): Promise<void> {
    event.preventDefault();
    const input = this.emailInput()?.nativeElement;
    if (!input) {
      return;
    }

    this.state.set('loading');
    const result = await this.newsletter.subscribe(input.value);
    this.state.set(result.status);

    if (result.status === 'ok') {
      input.value = '';
    }
  }
}
