import { Component, input } from '@angular/core';
import { RevealOnScrollDirective } from '../../directives/reveal-on-scroll';

@Component({
  selector: 'app-section-title',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './section-title.html',
  styleUrl: './section-title.css'
})
export class SectionTitle {
  readonly eyebrow = input<string>();
  readonly align = input<'left' | 'center'>('left');
  readonly theme = input<'light' | 'dark'>('light');
}
