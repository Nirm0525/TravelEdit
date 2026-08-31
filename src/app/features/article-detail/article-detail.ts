import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { ARTICLES, Article } from '../../core/data/articles';
import { PublicArticlesService } from '../../core/services/public-articles';
import { sanitizeRichHtml } from '../../core/utils/sanitize-rich-html';

@Component({
  selector: 'app-article-detail',
  imports: [RouterLink],
  templateUrl: './article-detail.html',
  styleUrl: './article-detail.css'
})
export class ArticleDetail {
  private readonly publicArticles = inject(PublicArticlesService);
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);
  private readonly sanitizer = inject(DomSanitizer);

  readonly slug = input.required<string>();

  private readonly liveArticle = signal<Article | null>(null);
  // Evita el "flash" de la vista "no encontrado" para un slug real: sin esto,
  // mientras getBySlug() todavía está en vuelo, article() ya devuelve null
  // (no hay match en el fallback ARTICLES hardcodeado) y el template muestra
  // el 404 un instante antes de reemplazarlo por el artículo real.
  readonly loading = signal(true);

  readonly article = computed<Article | null>(() => {
    const slug = this.slug();
    const live = this.liveArticle();
    if (live && live.slug === slug) {
      return live;
    }
    return ARTICLES.find((a) => a.slug === slug) ?? null;
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

  readonly authorInitials = computed<string>(() => {
    const author = this.article()?.author ?? '';
    return author
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? '')
      .join('');
  });

  readonly publishedAtLabel = computed<string | null>(() => {
    const value = this.article()?.publishedAt;
    if (!value) {
      return null;
    }
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) {
      return null;
    }
    return new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  });

  // No es un campo editorial más para llenar: se calcula solo a partir del
  // texto, así nunca queda desactualizado si el artículo se edita después.
  readonly readingTimeLabel = computed<string | null>(() => {
    const body = this.article()?.body;
    if (!body) {
      return null;
    }
    const wordCount = body
      .replace(/<[^>]*>/g, ' ')
      .split(/\s+/)
      .filter(Boolean).length;
    if (!wordCount) {
      return null;
    }
    const minutes = Math.max(1, Math.round(wordCount / 200));
    return `${minutes} min de lectura`;
  });

  constructor() {
    // El input `slug` viene del router (withComponentInputBinding) y todavía
    // no tiene valor en el primer tick del constructor — leerlo fuera de un
    // effect() dispara NG0950. El effect también hace que, si se navega de un
    // artículo a otro sin recargar la página, se vuelva a pedir el nuevo slug.
    effect(() => {
      void this.load(this.slug());
    });
  }

  private async load(slug: string): Promise<void> {
    this.loading.set(true);
    try {
      const live = await this.publicArticles.getBySlug(slug);
      if (live) {
        this.liveArticle.set(live);
      }
    } finally {
      this.loading.set(false);
    }

    const current = this.article();
    if (current) {
      this.title.setTitle(`${current.title} | The Travel Edit`);
      this.meta.updateTag({ name: 'description', content: current.excerpt });
    }
  }
}
