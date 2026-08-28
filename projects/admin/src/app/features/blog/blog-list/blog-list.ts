import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ArticlesService } from '../../../core/services/articles';
import { ArticleImagesService } from '../../../core/services/article-images';
import { ProfilesService } from '../../../core/services/profiles';
import { AuthService } from '../../../core/services/auth';
import { Article, ArticleStatus } from '../../../core/models/article.model';
import { ARTICLE_STATUS_LABEL } from '../../../core/data/article-options';
import { AdminPageHeader, BreadcrumbItem } from '../../../shared/ui/admin-page-header/admin-page-header';
import { AdminTable } from '../../../shared/ui/admin-table/admin-table';
import { StatusBadge, StatusBadgeVariant } from '../../../shared/ui/status-badge/status-badge';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VARIANT: Record<ArticleStatus, StatusBadgeVariant> = {
  draft: 'neutral',
  published: 'success'
};

@Component({
  selector: 'app-blog-list',
  imports: [RouterLink, DatePipe, AdminPageHeader, AdminTable, StatusBadge, ConfirmDialog],
  templateUrl: './blog-list.html',
  styleUrl: './blog-list.css'
})
export class BlogList {
  private readonly articlesService = inject(ArticlesService);
  private readonly images = inject(ArticleImagesService);
  private readonly profiles = inject(ProfilesService);
  private readonly auth = inject(AuthService);

  readonly isAdmin = this.auth.isAdmin;

  readonly breadcrumb: BreadcrumbItem[] = [{ label: 'Panel', link: '/dashboard' }, { label: 'Blog' }];
  readonly statusLabel = ARTICLE_STATUS_LABEL;
  readonly statusVariant = STATUS_VARIANT;

  readonly items = signal<Article[]>([]);
  readonly authorNameById = signal<Map<string, string>>(new Map());
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly statusFilter = signal<ArticleStatus | ''>('');
  readonly search = signal('');
  readonly togglingId = signal<string | null>(null);
  readonly toggleError = signal<string | null>(null);

  readonly pendingDelete = signal<Article | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly pageSize = PAGE_SIZE;
  private searchDebounce?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [result, names] = await Promise.all([
        this.articlesService.list({
          page: this.page(),
          pageSize: this.pageSize,
          status: this.statusFilter() || undefined,
          search: this.search().trim() || undefined
        }),
        this.profiles.nameMap()
      ]);
      this.items.set(result.items);
      this.total.set(result.total);
      this.authorNameById.set(names);
    } catch (error) {
      console.error('No se pudieron cargar los artículos.', error);
      this.loadError.set('No se pudieron cargar los artículos. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  coverUrl(item: Article): string | null {
    return this.images.resolveUrl(item.coverStoragePath);
  }

  authorLabel(item: Article): string {
    if (item.authorName) {
      return item.authorName;
    }
    if (item.authorId) {
      return this.authorNameById().get(item.authorId) ?? '—';
    }
    return '—';
  }

  async setStatusFilter(status: ArticleStatus | ''): Promise<void> {
    this.statusFilter.set(status);
    this.page.set(1);
    await this.load();
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  hasActiveFilters(): boolean {
    return !!this.statusFilter() || !!this.search().trim();
  }

  async clearFilters(): Promise<void> {
    this.statusFilter.set('');
    this.search.set('');
    this.page.set(1);
    await this.load();
  }

  async goToPage(page: number): Promise<void> {
    this.page.set(page);
    await this.load();
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.pageSize));
  }

  statusActionLabel(item: Article): string {
    return item.status === 'published' ? 'Despublicar' : 'Publicar';
  }

  async toggleStatus(item: Article): Promise<void> {
    if (this.togglingId()) {
      return;
    }
    const next: ArticleStatus = item.status === 'published' ? 'draft' : 'published';
    this.togglingId.set(item.id);
    this.toggleError.set(null);
    try {
      await this.articlesService.updateStatus(item.id, next);
      await this.load();
    } catch (error) {
      console.error('No se pudo actualizar el estado del artículo.', error);
      this.toggleError.set(
        next === 'published'
          ? 'No se pudo publicar el artículo. Inténtalo nuevamente.'
          : 'No se pudo despublicar el artículo. Inténtalo nuevamente.'
      );
    } finally {
      this.togglingId.set(null);
    }
  }

  askDelete(item: Article): void {
    this.deleteError.set(null);
    this.pendingDelete.set(item);
  }

  cancelDelete(): void {
    this.pendingDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const item = this.pendingDelete();
    if (!item || this.deleting()) {
      return;
    }
    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.articlesService.remove(item.id);
      this.pendingDelete.set(null);
      await this.load();
    } catch (error) {
      console.error('No se pudo eliminar el artículo.', error);
      this.deleteError.set('No se pudo eliminar el artículo. Inténtalo nuevamente.');
    } finally {
      this.deleting.set(false);
    }
  }
}
