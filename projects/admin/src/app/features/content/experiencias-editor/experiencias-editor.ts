import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { ExperienceItem } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-experiencias-editor',
  imports: [ReactiveFormsModule, DragDropModule, ContentEditorLayout],
  templateUrl: './experiencias-editor.html',
  styleUrl: './experiencias-editor.css'
})
export class ExperienciasEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly images = inject(SiteContentImagesService);
  private readonly fb = inject(FormBuilder);

  readonly iconOptions: ExperienceItem['icon'][] = ['heart', 'compass', 'column', 'lotus', 'sparkle'];

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly items = signal<ExperienceItem[]>([]);
  readonly uploadingIndex = signal<number | null>(null);
  readonly uploadError = signal<string | null>(null);

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    support: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const content = await this.siteContent.getExperiencias();
      this.form.patchValue(content);
      this.items.set(content.items);
    } catch (err) {
      console.error('No se pudo cargar la sección "Experiencias".', err);
      this.error.set('No se pudo cargar el contenido. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  updateItem(index: number, patch: Partial<ExperienceItem>): void {
    this.items.update((list) => list.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  }

  addItem(): void {
    this.items.update((list) => [...list, { slug: '', name: '', icon: 'heart', image: '', alt: '' }]);
  }

  removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<ExperienceItem[]>): void {
    const reordered = [...this.items()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.items.set(reordered);
  }

  async onImageSelected(index: number, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.uploadingIndex.set(index);
    this.uploadError.set(null);
    try {
      const url = await this.images.uploadExperienceImage(file);
      this.updateItem(index, { image: url });
    } catch {
      this.uploadError.set('No se pudo subir la imagen. Intenta de nuevo.');
    } finally {
      this.uploadingIndex.set(null);
    }
  }

  async save(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    try {
      await this.siteContent.updateExperiencias({ ...this.form.getRawValue(), items: this.items() });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
