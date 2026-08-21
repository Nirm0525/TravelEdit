import { AfterViewInit, Component, ElementRef, inject, viewChild } from '@angular/core';
import { TRAVEL_PROCESS_STEPS } from '../../core/data/travel-process';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { gsap, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

@Component({
  selector: 'app-travel-process',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './travel-process.html',
  styleUrl: './travel-process.css'
})
export class TravelProcess implements AfterViewInit {
  readonly steps = TRAVEL_PROCESS_STEPS;

  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly bg = viewChild<ElementRef<HTMLElement>>('bg');

  ngAfterViewInit(): void {
    if (this.reducedMotion.reduced()) {
      return;
    }

    const sectionEl = this.section()?.nativeElement;
    const bgEl = this.bg()?.nativeElement;
    if (!sectionEl || !bgEl) {
      return;
    }

    registerGsap();

    gsap.to(bgEl, {
      scale: 1.15,
      yPercent: 10,
      ease: 'none',
      scrollTrigger: {
        trigger: sectionEl,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true
      }
    });
  }
}
