import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { TravelProcessStep } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-travel-process-editor',
  imports: [ReactiveFormsModule, DragDropModule, ContentEditorLayout],
  templateUrl: './travel-process-editor.html',
  styleUrl: './travel-process-editor.css'
})
export class TravelProcessEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly fb = inject(FormBuilder);

  readonly iconOptions: TravelProcessStep['icon'][] = ['person', 'curate', 'plane'];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly steps = signal<TravelProcessStep[]>([]);

  readonly form = this.fb.group({
    titleLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const content = await this.siteContent.getTravelProcess();
      this.form.patchValue(content);
      this.steps.set(content.steps);
    } catch (err) {
      console.error('No se pudo cargar la sección "Travel Process".', err);
      this.error.set('No se pudo cargar el contenido. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  updateStep(index: number, patch: Partial<TravelProcessStep>): void {
    this.steps.update((list) => list.map((step, i) => (i === index ? { ...step, ...patch } : step)));
  }

  addStep(): void {
    this.steps.update((list) => [
      ...list,
      { number: String(list.length + 1).padStart(2, '0'), title: '', text: '', icon: 'person' }
    ]);
  }

  removeStep(index: number): void {
    this.steps.update((list) => list.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<TravelProcessStep[]>): void {
    const reordered = [...this.steps()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.steps.set(reordered);
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.siteContent.updateTravelProcess({ ...this.form.getRawValue(), steps: this.steps() });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
