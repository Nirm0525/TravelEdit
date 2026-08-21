import { Component, inject } from '@angular/core';
import { IMAGES } from '../../core/data/images';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { TravelEditFormService } from '../../core/services/travel-edit-form';

@Component({
  selector: 'app-final-cta',
  standalone: true,
  imports: [AnimatedButton, RevealOnScrollDirective],
  templateUrl: './final-cta.html',
  styleUrl: './final-cta.css'
})
export class FinalCta {
  private readonly travelEditForm = inject(TravelEditFormService);

  readonly image = IMAGES.finalCta;

  openTravelEditForm(): void {
    this.travelEditForm.open();
  }
}
