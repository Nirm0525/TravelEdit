import { AfterViewInit, Component, ElementRef, OnDestroy, inject, viewChild, signal } from '@angular/core';
import { gsap, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

@Component({
  selector: 'app-loading-screen',
  standalone: true,
  templateUrl: './loading-screen.html',
  styleUrl: './loading-screen.css'
})
export class LoadingScreen implements AfterViewInit, OnDestroy {
  private readonly reducedMotion = inject(ReducedMotionService);

  readonly visible = signal(true);

  private readonly overlay = viewChild.required<ElementRef<HTMLElement>>('overlay');
  private readonly line = viewChild.required<ElementRef<HTMLElement>>('line');
  private readonly logo = viewChild.required<ElementRef<HTMLElement>>('logo');
  private readonly tagline = viewChild.required<ElementRef<HTMLElement>>('tagline');

  private timeline?: gsap.core.Timeline;

  ngAfterViewInit(): void {
    const overlayEl = this.overlay().nativeElement;
    const lineEl = this.line().nativeElement;
    const logoEl = this.logo().nativeElement;
    const taglineEl = this.tagline().nativeElement;

    document.body.style.overflow = 'hidden';

    const finish = () => {
      this.visible.set(false);
      document.body.style.overflow = '';
    };

    registerGsap();

    if (this.reducedMotion.reduced()) {
      const tl = gsap.timeline({ onComplete: finish });
      this.timeline = tl;
      tl.set(lineEl, { scaleX: 1 })
        .set(logoEl, { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1 })
        .set(taglineEl, { opacity: 1, letterSpacing: '0.28em' })
        .to(overlayEl, { autoAlpha: 0, duration: 0.5, delay: 0.4, ease: 'power1.out' });
      return;
    }

    const tl = gsap.timeline({ delay: 0.25, onComplete: finish });
    this.timeline = tl;

    tl.to(lineEl, { scaleX: 1, duration: 0.6, ease: 'power2.inOut' })
      .to(logoEl, { clipPath: 'inset(0% 0% 0% 0%)', opacity: 1, duration: 0.8, ease: 'power2.inOut' }, '-=0.45')
      .to(taglineEl, { opacity: 1, letterSpacing: '0.28em', duration: 0.4, ease: 'power2.out' }, '-=0.35')
      .to(overlayEl, { autoAlpha: 0, duration: 0.55, ease: 'power2.inOut' }, '+=0.6');
  }

  ngOnDestroy(): void {
    this.timeline?.kill();
    document.body.style.overflow = '';
  }
}
