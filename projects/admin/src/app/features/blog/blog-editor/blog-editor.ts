import { Component, computed, inject, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ArticlesService } from '../../../core/services/articles';
import { ArticleImagesService } from '../../../core/services/article-images';
import { ProfilesService } from '../../../core/services/profiles';
import { AuthService } from '../../../core/services/auth';
import { Article, ArticleStatus } from '../../../core/models/article.model';
import { slugify } from '../../../core/utils/slugify';
import { ContentEditorLayout } from '../../../shared/ui/content-editor-layout/content-editor-layout';
import { RichTextEditor } from '../../../shared/ui/rich-text-editor/rich-text-editor';
import { ImageUploader, ReadyImage } from '../../../shared/ui/image-uploader/image-uploader';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { ARTICLE_STATUS_LABEL } from '../../../core/data/article-options';

function toDatetimeLocal(iso: string | null): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocal(value: string): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toISOString();
}

function isBodyEmpty(html: string): boolean {
  return html.replace(/<[^>]*>/g, '').trim().length === 0;
}

@Component({
  selector: 'app-blog-editor',
  imports: [ReactiveFormsModule, ContentEditorLayout, RichTextEditor, ImageUploader, ConfirmDialog, AdminPageHeader],
  templateUrl: './blog-editor.html',
  styleUrl: './blog-editor.css'
})
export class BlogEditor {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly articlesService = inject(ArticlesService);
  private readonly articleImages = inject(ArticleImagesService);
  private readonly profiles = inject(ProfilesService);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  readonly statusLabel = ARTICLE_STATUS_LABEL;
  readonly isAdmin = this.auth.isAdmin;

  readonly articleId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly isNew = computed(() => !this.articleId());

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly saved = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly status = signal<ArticleStatus>('draft');
  readonly publishing = signal(false);
  readonly publishError = signal<string | null>(null);

  readonly deleteConfirmOpen = signal(false);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly coverStoragePath = signal<string | null>(null);
  readonly coverAltTextValue = signal('');
  readonly uploadingCover = signal(false);
  readonly coverError = signal<string | null>(null);

  readonly authorNameById = signal<Map<string, string>>(new Map());
  readonly authorOptions = computed(() => Array.from(this.authorNameById().entries()).map(([id, name]) => ({ id, name })));

  readonly slugTouched = signal(false);

  readonly bodyImageUpload = (file: File): Promise<string> => this.articleImages.uploadBodyImage(file);

  readonly coverPreviewUrl = computed(() => this.articleImages.resolveUrl(this.coverStoragePath()));

  readonly form = this.fb.group({
    title: this.fb.control('', Validators.required),
    slug: this.fb.control('', Validators.required),
    excerpt: this.fb.control(''),
    tagsText: this.fb.control(''),
    authorId: this.fb.control<string | null>(null),
    authorName: this.fb.control(''),
    scheduledAt: this.fb.control(''),
    body: this.fb.control('')
  });

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const names = await this.profiles.nameMap();
      this.authorNameById.set(names);

      const id = this.articleId();
      if (id) {
        const article = await this.articlesService.getById(id);
        if (!article) {
          this.loadError.set('No se encontró este artículo.');
          return;
        }
        this.applyArticle(article);
      } else {
        this.form.controls.authorId.setValue(this.auth.profile()?.id ?? null);
      }
    } catch (error) {
      console.error('No se pudo cargar el artículo.', error);
      this.loadError.set('No se pudo cargar el artículo. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  private applyArticle(article: Article): void {
    this.status.set(article.status);
    this.coverStoragePath.set(article.coverStoragePath);
    this.coverAltTextValue.set(article.coverAltText ?? '');
    this.slugTouched.set(true);
    this.form.patchValue({
      title: article.title,
      slug: article.slug,
      excerpt: article.excerpt,
      tagsText: article.tags.join(', '),
      authorId: article.authorId,
      authorName: article.authorName ?? '',
      scheduledAt: toDatetimeLocal(article.scheduledAt),
      body: article.body
    });
  }

  onTitleInput(): void {
    if (this.slugTouched()) {
      return;
    }
    this.form.controls.slug.setValue(slugify(this.form.controls.title.value));
  }

  onSlugBlur(): void {
    this.slugTouched.set(true);
    const sanitized = slugify(this.form.controls.slug.value);
    this.form.controls.slug.setValue(sanitized);
  }

  async onCoverReady(images: ReadyImage[]): Promise<void> {
    const image = images[0];
    if (!image) {
      return;
    }
    this.uploadingCover.set(true);
    this.coverError.set(null);
    try {
      const path = await this.articleImages.uploadCover(image.file);
      this.coverStoragePath.set(path);
      this.coverAltTextValue.set(image.altText);
    } catch (error) {
      console.error('No se pudo subir la imagen de portada.', error);
      this.coverError.set('No se pudo subir la imagen. Inténtalo nuevamente.');
    } finally {
      this.uploadingCover.set(false);
    }
  }

  removeCover(): void {
    this.coverStoragePath.set(null);
    this.coverAltTextValue.set('');
  }

  private parseTags(): string[] {
    return this.form.controls.tagsText.value
      .split(',')
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  async save(): Promise<void> {
    if (this.saving()) {
      return;
    }

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.errorMessage.set('Revisa los campos obligatorios antes de guardar.');
      return;
    }

    if (isBodyEmpty(this.form.controls.body.value)) {
      this.errorMessage.set('Escribe el contenido del artículo antes de guardar.');
      return;
    }

    const sanitizedSlug = slugify(this.form.controls.slug.value);
    if (!sanitizedSlug) {
      this.errorMessage.set('El slug no es válido. Usa letras, números y guiones.');
      return;
    }
    this.form.controls.slug.setValue(sanitizedSlug);

    this.saving.set(true);
    this.saved.set(false);
    this.errorMessage.set(null);

    try {
      const available = await this.articlesService.isSlugAvailable(sanitizedSlug, this.articleId() ?? undefined);
      if (!available) {
        this.errorMessage.set('Ese slug ya está en uso por otro artículo.');
        return;
      }

      const raw = this.form.getRawValue();
      const payload = {
        title: raw.title,
        slug: sanitizedSlug,
        excerpt: raw.excerpt,
        body: raw.body,
        tags: this.parseTags(),
        coverStoragePath: this.coverStoragePath(),
        coverAltText: this.coverStoragePath() ? this.coverAltTextValue() || null : null,
        authorId: raw.authorId,
        authorName: raw.authorName.trim() || null,
        scheduledAt: fromDatetimeLocal(raw.scheduledAt)
      };

      const id = this.articleId();
      if (id) {
        const updated = await this.articlesService.update(id, payload);
        this.applyArticle(updated);
      } else {
        const created = await this.articlesService.create(payload);
        this.articleId.set(created.id);
        this.status.set(created.status);
        await this.router.navigate(['/blog', created.id], { replaceUrl: true });
      }

      this.saved.set(true);
    } catch (error) {
      console.error('No se pudo guardar el artículo.', error);
      this.errorMessage.set('No se pudieron guardar los cambios. Inténtalo nuevamente.');
    } finally {
      this.saving.set(false);
    }
  }

  statusActionLabel(): string {
    return this.status() === 'published' ? 'Despublicar' : 'Publicar';
  }

  async toggleStatus(): Promise<void> {
    const id = this.articleId();
    if (!id || this.publishing()) {
      return;
    }
    const next: ArticleStatus = this.status() === 'published' ? 'draft' : 'published';
    this.publishing.set(true);
    this.publishError.set(null);
    try {
      const updated = await this.articlesService.updateStatus(id, next);
      this.status.set(updated.status);
    } catch (error) {
      console.error('No se pudo actualizar el estado del artículo.', error);
      this.publishError.set(
        next === 'published'
          ? 'No se pudo publicar el artículo. Inténtalo nuevamente.'
          : 'No se pudo despublicar el artículo. Inténtalo nuevamente.'
      );
    } finally {
      this.publishing.set(false);
    }
  }

  askDelete(): void {
    this.deleteError.set(null);
    this.deleteConfirmOpen.set(true);
  }

  cancelDelete(): void {
    this.deleteConfirmOpen.set(false);
  }

  async confirmDelete(): Promise<void> {
    const id = this.articleId();
    if (!id || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.articlesService.remove(id);
      await this.router.navigateByUrl('/blog');
    } catch (error) {
      console.error('No se pudo eliminar el artículo.', error);
      this.deleteError.set('No se pudo eliminar el artículo. Inténtalo nuevamente.');
      this.deleteConfirmOpen.set(false);
    } finally {
      this.deleting.set(false);
    }
  }
}
