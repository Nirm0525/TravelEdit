import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { SiteContentService } from '../../../core/services/site-content';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-hero-editor',
  imports: [ReactiveFormsModule, ContentEditorLayout],
  templateUrl: './hero-editor.html',
  styleUrl: './hero-editor.css'
})
export class HeroEditor {
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

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    titleLine3: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    lead: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    ctaLabel: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    exploreLabel: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    imageUrl: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    imageAlt: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const hero = await this.siteContent.getHero();
    this.form.patchValue(hero);
    this.loading.set(false);
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
      const url = await this.images.uploadHeroImage(file);
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
      await this.siteContent.updateHero(this.form.getRawValue());
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
