import { Component } from '@angular/core';
import { IMAGES } from '../../core/data/images';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';

@Component({
  selector: 'app-final-cta',
  standalone: true,
  imports: [AnimatedButton, RevealOnScrollDirective],
  templateUrl: './final-cta.html',
  styleUrl: './final-cta.css'
})
export class FinalCta {
  readonly image = IMAGES.finalCta;
}
