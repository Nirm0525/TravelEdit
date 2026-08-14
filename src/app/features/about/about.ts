import { Component } from '@angular/core';
import { IMAGES } from '../../core/data/images';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './about.html',
  styleUrl: './about.css'
})
export class About {
  readonly image = IMAGES.about;
  readonly words = ['Intentional.', 'Personal.', 'Curated.', 'Meaningful.'];
}
