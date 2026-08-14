import { AfterViewInit, Component, ElementRef, inject, viewChild, viewChildren } from '@angular/core';
import { IMAGES } from '../../core/data/images';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { gsap, ScrollTrigger, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './hero.html',
  styleUrl: './hero.css'
})
export class Hero implements AfterViewInit {
  readonly image = IMAGES.hero;

  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly titleWords = viewChildren<ElementRef<HTMLElement>>('word');
  private readonly subtitle = viewChild<ElementRef<HTMLElement>>('subtitle');
  private readonly lead = viewChild<ElementRef<HTMLElement>>('lead');
  private readonly actions = viewChild<ElementRef<HTMLElement>>('actions');
  private readonly bg = viewChild<ElementRef<HTMLElement>>('bg');
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');

  ngAfterViewInit(): void {
    if (this.reducedMotion.reduced()) {
      return;
    }

    registerGsap();

    const tl = gsap.timeline({ delay: 0.2 });
    tl.from(this.bg()?.nativeElement ?? [], { opacity: 0, duration: 1.4, ease: 'power2.out' })
      .from(this.titleWords().map((w) => w.nativeElement), {
        yPercent: 110,
        opacity: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: 'power3.out'
      }, '-=0.8')
      .from(this.subtitle()?.nativeElement ?? [], { y: 16, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.35')
      .from(this.lead()?.nativeElement ?? [], { y: 16, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.45')
      .from(this.actions()?.nativeElement ?? [], { y: 16, opacity: 0, duration: 0.7, ease: 'power2.out' }, '-=0.45');

    const sectionEl = this.section()?.nativeElement;
    const bgEl = this.bg()?.nativeElement;
    if (sectionEl && bgEl) {
      gsap.to(bgEl, {
        scale: 1.12,
        yPercent: 8,
        ease: 'none',
        scrollTrigger: {
          trigger: sectionEl,
          start: 'top top',
          end: 'bottom top',
          scrub: true
        }
      });
    }
  }
}
