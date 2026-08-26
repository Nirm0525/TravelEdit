import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal, viewChild, viewChildren } from '@angular/core';
import { Router } from '@angular/router';
import { IMAGES } from '../../core/data/images';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { gsap, ScrollTrigger, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';
import { HeroContent, SiteContentService } from '../../core/services/site-content';

const HERO_DEFAULT: HeroContent = {
  eyebrow: 'Bespoke Travel Experiences',
  titleLine1: 'Because',
  titleLine2: 'luxury',
  titleLine3: 'is personal.',
  lead: 'Viajes diseñados a tu manera.\nCuidando cada detalle para que cada experiencia. Se sienta realmente tuya.',
  ctaLabel: 'DISEÑA TU VIAJE',
  exploreLabel: 'EXPLORE',
  imageUrl: IMAGES.hero.url,
  imageAlt: IMAGES.hero.alt
};

@Component({
  selector: 'app-hero',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './hero.html',
  styleUrl: './hero.css'
})
export class Hero implements AfterViewInit, OnDestroy {
  private readonly siteContent = inject(SiteContentService);
  readonly content = signal<HeroContent>(HERO_DEFAULT);

  private readonly router = inject(Router);
  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly titleWords = viewChildren<ElementRef<HTMLElement>>('word');
  private readonly subtitle = viewChild<ElementRef<HTMLElement>>('subtitle');
  private readonly lead = viewChild<ElementRef<HTMLElement>>('lead');
  private readonly actions = viewChild<ElementRef<HTMLElement>>('actions');
  private readonly bg = viewChild<ElementRef<HTMLElement>>('bg');
  private readonly section = viewChild<ElementRef<HTMLElement>>('section');
  private introTimeline?: gsap.core.Timeline;
  private scrollTween?: gsap.core.Tween;

  constructor() {
    void this.siteContent.getHero().then((data) => {
      if (data) {
        this.content.update((current) => ({ ...current, ...data }));
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.reducedMotion.reduced()) {
      return;
    }

    registerGsap();

    const tl = gsap.timeline({ delay: 0.2 });
    this.introTimeline = tl;
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
      this.scrollTween = gsap.to(bgEl, {
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

  ngOnDestroy(): void {
    this.introTimeline?.kill();
    this.scrollTween?.scrollTrigger?.kill();
    this.scrollTween?.kill();
  }

  openTravelEditForm(): void {
    void this.router.navigate(['/disenar-tu-viaje']);
  }
}
