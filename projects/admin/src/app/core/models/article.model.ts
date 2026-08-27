import { Database } from './database.types';

type ArticleRow = Database['public']['Tables']['articles']['Row'];

export type ArticleStatus = 'draft' | 'published';

export interface Article {
  id: string;
  slug: string;
  title: string;
  authorId: string | null;
  authorName: string | null;
  excerpt: string;
  coverStoragePath: string | null;
  coverAltText: string | null;
  body: string;
  tags: string[];
  status: ArticleStatus;
  scheduledAt: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toArticle(row: ArticleRow): Article {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    authorId: row.author_id,
    authorName: row.author_name,
    excerpt: row.excerpt,
    coverStoragePath: row.cover_storage_path,
    coverAltText: row.cover_alt_text,
    body: row.body,
    tags: row.tags,
    // La columna real es `text` con un check constraint 'draft'|'published' —
    // se castea acá, en el único punto de entrada desde la base.
    status: row.status as ArticleStatus,
    scheduledAt: row.scheduled_at,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
