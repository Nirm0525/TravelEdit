import { Component, input } from '@angular/core';
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
}
