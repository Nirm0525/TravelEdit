import { Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { SiteContentService } from '../../../core/services/site-content';
import { SiteContentImagesService } from '../../../core/services/site-content-images';
import { EditArticle } from '../../../core/models/site-content.model';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';
import { RichTextEditor } from '../../../shared/ui/rich-text-editor/rich-text-editor';
import { PreviewModal } from '../../../shared/ui/preview-modal/preview-modal';
import { slugify } from '../../../core/utils/slugify';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-the-edit-editor',
  imports: [ReactiveFormsModule, FormsModule, DragDropModule, ContentEditorLayout, RichTextEditor, PreviewModal],
  templateUrl: './the-edit-editor.html',
  styleUrl: './the-edit-editor.css'
})
export class TheEditEditor {
  private readonly siteContent = inject(SiteContentService);
  private readonly images = inject(SiteContentImagesService);
  private readonly fb = inject(FormBuilder);

  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly savedAt = signal<Date | null>(null);
  readonly error = signal<string | null>(null);

  readonly articles = signal<EditArticle[]>([]);
  readonly uploadingIndex = signal<number | null>(null);
  readonly uploadError = signal<string | null>(null);

  readonly bodyImageUpload = (file: File): Promise<string> => this.images.uploadArticleImage(file);

  readonly previewSlug = signal<string | null>(null);
  readonly previewUrl = computed(() => {
    const slug = this.previewSlug();
    return slug ? `${environment.publicSiteUrl}/the-edit/${slug}` : null;
  });

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
    const content = await this.siteContent.getTheEdit();
    this.form.patchValue(content);
    this.articles.set(content.articles);
    this.loading.set(false);
  }

  updateArticle(index: number, patch: Partial<EditArticle>): void {
    this.articles.update((list) => list.map((article, i) => (i === index ? { ...article, ...patch } : article)));
  }

  onTitleInput(index: number, title: string): void {
    const article = this.articles()[index];
    if (!article) {
      return;
    }
    const patch: Partial<EditArticle> = { title };
    if (!article.slug || article.slug === slugify(article.title)) {
      patch.slug = slugify(title);
    }
    this.updateArticle(index, patch);
  }

  addArticle(): void {
    this.articles.update((list) => [
      ...list,
      { slug: '', category: '', title: '', excerpt: '', author: '', image: '', alt: '', body: '' }
    ]);
  }

  removeArticle(index: number): void {
    this.articles.update((list) => list.filter((_, i) => i !== index));
  }

  drop(event: CdkDragDrop<EditArticle[]>): void {
    const reordered = [...this.articles()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.articles.set(reordered);
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
      const url = await this.images.uploadArticleImage(file);
      this.updateArticle(index, { image: url });
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
      await this.siteContent.updateTheEdit({ ...this.form.getRawValue(), articles: this.articles() });
      this.savedAt.set(new Date());
    } catch {
      this.error.set('No se pudieron guardar los cambios. Intenta nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }
}
