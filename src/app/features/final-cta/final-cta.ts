import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { IMAGES } from '../../core/data/images';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { SiteContentService } from '../../core/services/site-content';

interface FinalCtaLink {
  label: string;
  href: string;
}

interface FinalCtaContent {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  text: string;
  ctaLabel: string;
  imageUrl: string;
  imageAlt: string;
  links: FinalCtaLink[];
}

const FINAL_CTA_DEFAULT: FinalCtaContent = {
  eyebrow: 'Your Next Story Starts Here',
  titleLine1: 'Where',
  titleLine2: 'to next?',
  text: "Let's create something unforgettable.",
  ctaLabel: 'START YOUR JOURNEY',
  imageUrl: IMAGES.finalCta.url,
  imageAlt: IMAGES.finalCta.alt,
  links: [
    { label: 'Instagram', href: 'https://www.instagram.com/thetraveledithn/' },
    { label: 'WhatsApp', href: 'https://wa.me/50433070330' },
    { label: 'Email', href: 'mailto:marcela@travelinternational.org' }
  ]
};

@Component({
  selector: 'app-final-cta',
  standalone: true,
  imports: [AnimatedButton, RevealOnScrollDirective],
  templateUrl: './final-cta.html',
  styleUrl: './final-cta.css'
})
export class FinalCta {
  private readonly router = inject(Router);
  private readonly siteContent = inject(SiteContentService);

  readonly content = signal<FinalCtaContent>(FINAL_CTA_DEFAULT);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getCtaFinal();
    if (data) {
      this.content.update((current) => ({ ...current, ...data }));
    }
  }

  openTravelEditForm(): void {
    void this.router.navigate(['/disenar-tu-viaje']);
  }
}
