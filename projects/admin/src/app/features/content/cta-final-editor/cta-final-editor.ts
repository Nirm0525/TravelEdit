import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { CtaFinalLink } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-cta-final-editor',
  imports: [ReactiveFormsModule, DragDropModule, ContentEditorLayout],
  templateUrl: './cta-final-editor.html',
  styleUrl: './cta-final-editor.css'
})
export class CtaFinalEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly images = inject(SiteContentImagesService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly previewUrl = signal<string | null>(null);

  readonly links = signal<CtaFinalLink[]>([]);

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    text: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    ctaLabel: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    imageUrl: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    imageAlt: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const content = await this.siteContent.getCtaFinal();
      this.form.patchValue(content);
      this.links.set(content.links);
    } catch (err) {
      console.error('No se pudo cargar la sección "CTA final".', err);
      this.error.set('No se pudo cargar el contenido. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  updateLink(index: number, patch: Partial<CtaFinalLink>): void {
    this.links.update((list) => list.map((link, i) => (i === index ? { ...link, ...patch } : link)));
  }

  addLink(): void {
    this.links.update((list) => [...list, { label: '', href: '' }]);
  }

  removeLink(index: number): void {
    this.links.update((list) => list.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<CtaFinalLink[]>): void {
    const reordered = [...this.links()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.links.set(reordered);
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) {
      return;
    }

    this.uploading.set(true);
    this.uploadError.set(null);
    const objectUrl = URL.createObjectURL(file);
    this.previewUrl.set(objectUrl);

    try {
      const url = await this.images.uploadCtaFinalImage(file);
      this.form.controls.imageUrl.setValue(url);
    } catch {
      this.uploadError.set('No se pudo subir la imagen. Intenta de nuevo.');
    } finally {
      URL.revokeObjectURL(objectUrl);
      this.previewUrl.set(null);
      this.uploading.set(false);
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
      await this.siteContent.updateCtaFinal({ ...this.form.getRawValue(), links: this.links() });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
