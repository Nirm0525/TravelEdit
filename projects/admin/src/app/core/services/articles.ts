import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Article, ArticleStatus, toArticle } from '../models/article.model';
import { slugify } from '../utils/slugify';

export interface ArticleListPage {
  items: Article[];
  total: number;
}

export interface ArticleListParams {
  page: number;
  pageSize: number;
  status?: ArticleStatus;
  search?: string;
}

export interface ArticlePayload {
  title: string;
  slug: string;
  excerpt?: string;
  tags?: string[];
  coverStoragePath?: string | null;
  coverAltText?: string | null;
  authorId?: string | null;
  authorName?: string | null;
  scheduledAt?: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class ArticlesService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async list(params: ArticleListParams): Promise<ArticleListPage> {
    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    let query = this.supabase.client
      .from('articles')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.search) {
      query = query.ilike('title', `%${params.search}%`);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    return {
      items: (data ?? []).map(toArticle),
      total: count ?? 0
    };
  }

  async getById(id: string): Promise<Article | null> {
    const { data, error } = await this.supabase.client.from('articles').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toArticle(data) : null;
  }

  /** Verdadero solo si NINGÚN otro artículo (excluyendo el que se está editando) ya usa ese slug. */
  async isSlugAvailable(slug: string, excludeId?: string): Promise<boolean> {
    let query = this.supabase.client.from('articles').select('id').eq('slug', slug);
    if (excludeId) {
      query = query.neq('id', excludeId);
    }
    const { data, error } = await query.maybeSingle();
    if (error) {
      throw error;
    }
    return !data;
  }

  /** Siempre crea en 'draft' — publicar es un paso explícito aparte, nunca implícito al guardar.
   *  `body` NUNCA se manda aquí: esa columna solo se escribe vía save-rich-content (Edge Function
   *  con service role), igual que destinations.long_description — ver RichContentService. Se crea
   *  con body vacío y el llamador debe guardar el contenido real con RichContentService.save()
   *  inmediatamente después, usando el id devuelto. */
  async create(payload: ArticlePayload): Promise<Article> {
    const { data, error } = await this.supabase.client
      .from('articles')
      .insert({
        title: payload.title,
        slug: payload.slug,
        excerpt: payload.excerpt ?? '',
        body: '',
        tags: payload.tags ?? [],
        cover_storage_path: payload.coverStoragePath ?? null,
        cover_alt_text: payload.coverAltText ?? null,
        author_id: payload.authorId ?? this.auth.profile()?.id ?? null,
        author_name: payload.authorName ?? null,
        scheduled_at: payload.scheduledAt ?? null,
        status: 'draft'
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toArticle(data);
  }

  /** `body` no se toca aquí — ver nota de create(). El llamador guarda el contenido con
   *  RichContentService.save('articles', id, html) por separado. */
  async update(id: string, payload: ArticlePayload): Promise<Article> {
    const { data, error } = await this.supabase.client
      .from('articles')
      .update({
        title: payload.title,
        slug: payload.slug,
        excerpt: payload.excerpt ?? '',
        tags: payload.tags ?? [],
        cover_storage_path: payload.coverStoragePath ?? null,
        cover_alt_text: payload.coverAltText ?? null,
        author_id: payload.authorId ?? null,
        author_name: payload.authorName ?? null,
        scheduled_at: payload.scheduledAt ?? null
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toArticle(data);
  }

  async updateStatus(id: string, status: ArticleStatus): Promise<Article> {
    const patch: { status: ArticleStatus; published_at?: string } = { status };
    if (status === 'published') {
      patch.published_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase.client
      .from('articles')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toArticle(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('articles').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  suggestSlug(title: string): string {
    return slugify(title);
  }
}
