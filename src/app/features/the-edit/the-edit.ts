import { Component } from '@angular/core';
import { ARTICLES } from '../../core/data/articles';
import { ArticleCard } from './article-card/article-card';
import { SectionTitle } from '../../shared/ui/section-title/section-title';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';

@Component({
  selector: 'app-the-edit',
  standalone: true,
  imports: [ArticleCard, SectionTitle, AnimatedButton],
  templateUrl: './the-edit.html',
  styleUrl: './the-edit.css'
})
export class TheEdit {
  readonly articles = ARTICLES;
}
