import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { ProcessStep, TRAVEL_PROCESS_STEPS } from '../../core/data/travel-process';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { gsap, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';
import { SiteContentService } from '../../core/services/site-content';

interface TravelProcessHeading {
  titleLine1: string;
  titleLine2: string;
}

const HEADING_DEFAULT: TravelProcessHeading = {
  titleLine1: 'Not a trip.',
  titleLine2: 'Your edit.'
};

@Component({
  selector: 'app-travel-process',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './travel-process.html',
  styleUrl: './travel-process.css'
})
export class TravelProcess implements AfterViewInit, OnDestroy {
  private readonly siteContent = inject(SiteContentService);

  readonly heading = signal<TravelProcessHeading>(HEADING_DEFAULT);
  readonly steps = signal<ProcessStep[]>(TRAVEL_PROCESS_STEPS);

  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private readonly bg = viewChild<ElementRef<HTMLElement>>('bg');
  private scrollTween?: gsap.core.Tween;

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getTravelProcess();
    if (!data) {
      return;
    }
    this.heading.update((current) => ({ ...current, ...data }));
    if (data.steps && data.steps.length > 0) {
      this.steps.set(data.steps);
    }
  }

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

    this.scrollTween = gsap.to(bgEl, {
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

  ngOnDestroy(): void {
    this.scrollTween?.scrollTrigger?.kill();
    this.scrollTween?.kill();
  }
}
