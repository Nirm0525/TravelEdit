import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { SiteContentService } from '../../../core/services/site-content';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-custom-section-editor',
  imports: [ReactiveFormsModule, ContentEditorLayout, RouterLink],
  templateUrl: './custom-section-editor.html',
  styleUrl: './custom-section-editor.css'
})
export class CustomSectionEditor {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly siteContent = inject(SiteContentService);
  private readonly images = inject(SiteContentImagesService);
  private readonly fb = inject(FormBuilder);

  readonly sectionId = this.route.snapshot.paramMap.get('id')!;

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);
  readonly notFound = signal(false);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly previewUrl = signal<string | null>(null);

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    title: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    body: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    imageUrl: this.fb.control('', { nonNullable: true }),
    imageAlt: this.fb.control('', { nonNullable: true })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const content = await this.siteContent.getCustomSections();
      const section = content.sections.find((s) => s.id === this.sectionId);

      if (!section) {
        this.notFound.set(true);
        return;
      }

      this.form.patchValue(section);
    } catch (err) {
      console.error('No se pudo cargar la sección personalizada.', err);
      this.error.set('No se pudo cargar el contenido. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
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
      const url = await this.images.uploadCustomSectionImage(file);
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
      const content = await this.siteContent.getCustomSections();
      const updated = content.sections.map((s) =>
        s.id === this.sectionId ? { ...s, ...this.form.getRawValue() } : s
      );
      await this.siteContent.updateCustomSections({ sections: updated });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    try {
      const content = await this.siteContent.getCustomSections();
      const updated = content.sections.filter((s) => s.id !== this.sectionId);
      await this.siteContent.updateCustomSections({ sections: updated });
      await this.router.navigateByUrl('/contenido');
    } catch {
      this.error.set('No se pudo eliminar la sección. Intenta nuevamente.');
      this.saving.set(false);
    }
  }
}
