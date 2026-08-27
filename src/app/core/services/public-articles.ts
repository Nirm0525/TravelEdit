import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { Article } from '../data/articles';

const COVER_BUCKET = 'article-covers';

interface ArticleRow {
  slug: string;
  title: string;
  excerpt: string;
  author_name: string | null;
  tags: string[];
  cover_storage_path: string | null;
  cover_alt_text: string | null;
  body: string;
  published_at: string | null;
}

/**
 * Lee artículos reales de la tabla `articles` (administrada desde /admin/blog).
 * La policy SELECT de esa tabla ya solo deja leer filas `status = 'published'`
 * (y respeta `scheduled_at`) a un usuario anónimo — igual que
 * PublicDestinationsService con `destinations`, no hace falta filtrar acá.
 */
@Injectable({
  providedIn: 'root'
})
export class PublicArticlesService {
  private readonly supabase = inject(SupabaseService);

  async listPublished(limit: number): Promise<Article[]> {
    const { data, error } = await this.supabase.client
      .from('articles')
      .select('slug, title, excerpt, author_name, tags, cover_storage_path, cover_alt_text, body, published_at')
      .order('published_at', { ascending: false })
      .limit(limit);

    if (error || !data) {
      return [];
    }
    return (data as ArticleRow[]).map((row) => this.toArticle(row));
  }

  async getBySlug(slug: string): Promise<Article | null> {
    const { data, error } = await this.supabase.client
      .from('articles')
      .select('slug, title, excerpt, author_name, tags, cover_storage_path, cover_alt_text, body, published_at')
      .eq('slug', slug)
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    return this.toArticle(data as ArticleRow);
  }

  /** Los artículos migrados guardan `cover_storage_path` como una URL completa
   *  (a otro bucket o a Unsplash); los nuevos, subidos desde /admin/blog, guardan
   *  un path relativo al bucket `article-covers`. Hay que distinguirlos. */
  private resolveCoverUrl(pathOrUrl: string | null): string {
    if (!pathOrUrl) {
      return '';
    }
    if (pathOrUrl.startsWith('http')) {
      return pathOrUrl;
    }
    return this.supabase.client.storage.from(COVER_BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  }

  private toArticle(row: ArticleRow): Article {
    const image = this.resolveCoverUrl(row.cover_storage_path);
    return {
      slug: row.slug,
      category: (row.tags[0] ?? '').toUpperCase(),
      title: row.title,
      excerpt: row.excerpt,
      author: row.author_name ?? 'The Travel Edit',
      publishedAt: row.published_at ? row.published_at.slice(0, 10) : '',
      image,
      alt: row.cover_alt_text ?? '',
      cardImage: '',
      cardAlt: '',
      body: row.body
    };
  }
}
