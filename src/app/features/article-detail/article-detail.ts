import { Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { ARTICLES, Article } from '../../core/data/articles';
import { SiteContentService } from '../../core/services/site-content';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';

@Component({
  selector: 'app-article-detail',
  imports: [RouterLink],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.css'
})
export class ArticleDetail {
  private readonly siteContent = inject(SiteContentService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly sanitizer = inject(DomSanitizer);

  readonly slug = input.required<string>();

  private readonly cmsArticles = signal<Article[] | null>(null);

  readonly article = computed<Article | null>(() => {
    const slug = this.slug();
    const fromCms = this.cmsArticles()?.find((a) => a.slug === slug);
    return fromCms ?? ARTICLES.find((a) => a.slug === slug) ?? null;
  });

  // Angular's [innerHTML] sanitizer strips every `style` attribute outright,
  // which is what was silently dropping font-family/color/etc. set from the
  // rich text editor. sanitizeRichHtml() runs its own allow-list pass first
  // (tags, attributes, and a narrow set of typographic style properties with
  // their values checked), so trusting its output here isn't skipping
  // sanitization — it's replacing Angular's blanket style-stripping with a
  // targeted one that still keeps the content out.
  readonly safeBody = computed<SafeHtml | null>(() => {
    const body = this.article()?.body;
    return body ? this.sanitizer.bypassSecurityTrustHtml(sanitizeRichHtml(body)) : null;
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getTheEdit();
    if (data?.articles) {
      this.cmsArticles.set(data.articles as Article[]);
    }

    const current = this.article();
    if (current) {
      this.title.setTitle(`${current.title} | The Travel Edit`);
      this.meta.updateTag({ name: 'description', content: current.excerpt });
    }
  }
}
