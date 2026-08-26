import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Article } from '../../../core/data/articles';
import { RevealOnScrollDirective } from '../../../shared/directives/reveal-on-scroll';

@Component({
  selector: 'app-article-card',
  standalone: true,
  imports: [RevealOnScrollDirective, RouterLink],
  templateUrl: './article-card.html',
  styleUrl: './article-card.css'
})
export class ArticleCard {
  readonly article = input.required<Article>();

  // La tarjeta puede tener su propia foto — si no se definió una, usa la del hero.
  readonly cardImage = computed(() => this.article().cardImage || this.article().image);
  readonly cardAlt = computed(() => this.article().cardAlt || this.article().alt);
}
