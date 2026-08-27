import { ArticleStatus } from '../models/article.model';

export const ARTICLE_STATUS_LABEL: Record<ArticleStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado'
};

export const ARTICLE_STATUS_OPTIONS: ReadonlyArray<{ value: ArticleStatus; label: string }> = [
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicado' }
];
