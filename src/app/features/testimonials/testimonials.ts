import { Component, ElementRef, signal, viewChild } from '@angular/core';
import { TESTIMONIALS } from '../../core/data/testimonials';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { gsap } from '../../core/gsap/gsap-setup';

@Component({
  selector: 'app-testimonials',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './testimonials.html',
  styleUrl: './testimonials.css'
})
export class Testimonials {
  readonly testimonials = TESTIMONIALS;
  readonly index = signal(0);

  private readonly panel = viewChild<ElementRef<HTMLElement>>('panel');

  get current() {
    return this.testimonials[this.index()];
  }

  initials(name: string): string {
    return name
      .split(/[\s&]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase();
  }

  previous(): void {
    this.go((this.index() - 1 + this.testimonials.length) % this.testimonials.length);
  }

  next(): void {
    this.go((this.index() + 1) % this.testimonials.length);
  }

  private go(nextIndex: number): void {
    if (nextIndex === this.index()) {
      return;
    }

    const el = this.panel()?.nativeElement;
    if (!el) {
      this.index.set(nextIndex);
      return;
    }

    gsap.to(el, {
      autoAlpha: 0,
      duration: 0.25,
      onComplete: () => {
        this.index.set(nextIndex);
        gsap.to(el, { autoAlpha: 1, duration: 0.4 });
      }
    });
  }
}
