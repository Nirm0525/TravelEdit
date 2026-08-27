import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { SiteContentService } from '../../../core/services/site-content';
import { EditArticle } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';

@Component({
  selector: 'app-the-edit-editor',
  imports: [ReactiveFormsModule, ContentEditorLayout, RouterLink],
  templateUrl: './the-edit-editor.html',
  styleUrl: './the-edit-editor.css'
})
export class TheEditEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  // Los artículos en sí ahora se administran desde /admin/blog (tabla `articles`).
  // Esta sección solo edita el encabezado — el array se carga y se vuelve a
  // guardar TAL CUAL, sin tocarlo, para no perder lo que ya vivía en
  // site_content.the_edit.
  private articles: EditArticle[] = [];

  readonly form = this.fb.group({
    eyebrow: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    headingLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    supportLine1: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    supportLine2: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    ctaLabel: this.fb.control('', { nonNullable: true, validators: [Validators.required] }),
    ctaHref: this.fb.control('', { nonNullable: true, validators: [Validators.required] })
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const content = await this.siteContent.getTheEdit();
      this.form.patchValue(content);
      this.articles = content.articles;
    } catch (err) {
      console.error('No se pudo cargar la sección "The Edit".', err);
      this.error.set('No se pudo cargar el contenido. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
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
      await this.siteContent.updateTheEdit({ ...this.form.getRawValue(), articles: this.articles });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
