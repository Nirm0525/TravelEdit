import { Directive, ElementRef, OnDestroy, OnInit, inject, input } from '@angular/core';

function toDelay(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isNaN(parsed) ? 0 : parsed;
}
import { gsap, ScrollTrigger, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

@Directive({
  selector: '[appRevealOnScroll]',
  standalone: true
})
export class RevealOnScrollDirective implements OnInit, OnDestroy {

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly reducedMotion = inject(ReducedMotionService);
  private trigger?: ScrollTrigger;

  readonly revealDelay = input(0, { alias: 'appRevealOnScroll', transform: toDelay });
  readonly revealY = input(32);

  ngOnInit(): void {
    if (this.reducedMotion.reduced()) {
      return;
    }

    registerGsap();
    const host = this.el.nativeElement;
    const tween = gsap.fromTo(
      host,
      { autoAlpha: 0, y: this.revealY() },
      {
        autoAlpha: 1,
        y: 0,
        duration: 0.9,
        delay: this.revealDelay(),
        ease: 'power3.out',
        scrollTrigger: {
          trigger: host,
          start: 'top 85%'
        }
      }
    );

    this.trigger = tween.scrollTrigger;
  }

  ngOnDestroy(): void {
    this.trigger?.kill();
  }
}
