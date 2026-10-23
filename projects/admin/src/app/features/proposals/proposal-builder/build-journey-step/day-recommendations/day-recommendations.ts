import { Component, effect, input, output, signal } from '@angular/core';
import { merge } from 'rxjs';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ProposalDayRecommendations, normalizeDayRecommendations } from '../../../../../core/models/proposal.model';
import { ConfirmDialog } from '../../../../../shared/ui/confirm-dialog/confirm-dialog';
import { RichTextEditor } from '../../../../../shared/ui/rich-text-editor/rich-text-editor';

export type RecommendationsPhase = 'idle' | 'saving' | 'saved' | 'error';

export interface RecommendationsStatus {
  phase: RecommendationsPhase;
  message?: string;
}

/**
 * Bloque opcional «Recomendaciones» de un día. Compartido por propuestas e itinerarios (los dos usan el mismo paso de
 * armado). Es presentacional: mantiene el borrador y avisa con `save` / `remove`; quien lo usa persiste y devuelve el
 * estado. Si el guardado falla, el borrador no se toca.
 */
@Component({
  selector: 'app-day-recommendations',
  imports: [ReactiveFormsModule, RichTextEditor, ConfirmDialog],
  templateUrl: './day-recommendations.html',
  styleUrl: './day-recommendations.css'
})
export class DayRecommendations {
  /** Lo último guardado (undefined = el día no tiene recomendaciones). */
  readonly value = input<ProposalDayRecommendations | undefined>(undefined);
  readonly dayNumber = input.required<number>();
  readonly status = input<RecommendationsStatus>({ phase: 'idle' });
  readonly imageUpload = input<((file: File) => Promise<string>) | null>(null);

  readonly save = output<ProposalDayRecommendations | undefined>();
  readonly remove = output<void>();

  readonly headline = new FormControl('', { nonNullable: true });
  readonly body = new FormControl('', { nonNullable: true });
  readonly open = signal(false);
  readonly confirmingRemove = signal(false);
  /** Hay cambios escritos después del último guardado: el «Guardado ✓» ya no aplica. */
  readonly edited = signal(false);

  constructor() {
    merge(this.headline.valueChanges, this.body.valueChanges).subscribe(() => this.edited.set(true));
    // Mientras el asesor no haya tocado nada, el formulario sigue a lo guardado (carga, recarga, otro guardado).
    effect(() => {
      const saved = this.value();
      if (this.isDirty()) {
        return;
      }
      this.headline.setValue(saved?.headline ?? '', { emitEvent: false });
      this.body.setValue(saved?.body ?? '', { emitEvent: false });
      if (saved) {
        this.open.set(true);
      }
    });
    // Un guardado exitoso deja el borrador como «limpio»; uno fallido lo conserva tal cual.
    effect(() => {
      if (this.status().phase === 'saved') {
        this.headline.markAsPristine();
        this.body.markAsPristine();
        this.edited.set(false);
      }
    });
  }

  private isDirty(): boolean {
    return this.headline.dirty || this.body.dirty;
  }

  show(): void {
    this.open.set(true);
  }

  submit(): void {
    this.edited.set(false);
    this.save.emit(normalizeDayRecommendations(this.headline.value, this.body.value));
  }

  requestRemove(): void {
    const hasDraft = !!(this.value() || this.headline.value.trim() || this.body.value.trim());
    if (hasDraft) {
      this.confirmingRemove.set(true);
    } else {
      this.open.set(false);
    }
  }

  cancelRemove(): void {
    this.confirmingRemove.set(false);
  }

  confirmRemove(): void {
    this.confirmingRemove.set(false);
    this.headline.reset('', { emitEvent: false });
    this.body.reset('', { emitEvent: false });
    if (this.value()) {
      this.remove.emit();
    }
    this.open.set(false);
  }
}
