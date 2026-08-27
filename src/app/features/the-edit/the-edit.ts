import { Component, inject, signal } from '@angular/core';
import { ARTICLES, Article } from '../../core/data/articles';
import { ArticleCard } from './article-card/article-card';
import { SectionTitle } from '../../shared/ui/section-title/section-title';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { SiteContentService } from '../../core/services/site-content';
import { PublicArticlesService } from '../../core/services/public-articles';

const ARTICLES_LIMIT = 3;

interface TheEditHeading {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  supportLine1: string;
  supportLine2: string;
  ctaLabel: string;
  ctaHref: string;
}

const HEADING_DEFAULT: TheEditHeading = {
  eyebrow: 'The Edit',
  headingLine1: 'Stories worth',
  headingLine2: 'collecting.',
  supportLine1: 'Inspiration. Curated.',
  supportLine2: 'For the curious soul.',
  ctaLabel: 'EXPLORE THE EDIT',
  ctaHref: '#the-edit'
};

@Component({
  selector: 'app-the-edit',
  standalone: true,
  imports: [ArticleCard, SectionTitle, AnimatedButton],
  templateUrl: './the-edit.html',
  styleUrl: './the-edit.css'
})
export class TheEdit {
  private readonly siteContent = inject(SiteContentService);
  private readonly publicArticles = inject(PublicArticlesService);

  readonly heading = signal<TheEditHeading>(HEADING_DEFAULT);
  readonly articles = signal<Article[]>(ARTICLES);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const [heading, articles] = await Promise.all([
      this.siteContent.getTheEdit(),
      this.publicArticles.listPublished(ARTICLES_LIMIT)
    ]);

    if (heading) {
      this.heading.update((current) => ({ ...current, ...heading }));
    }
    if (articles.length > 0) {
      this.articles.set(articles);
    }
  }
}
