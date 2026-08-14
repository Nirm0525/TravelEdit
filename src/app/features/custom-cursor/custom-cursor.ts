import { AfterViewInit, Component, ElementRef, OnDestroy, inject, signal, viewChild } from '@angular/core';
import { gsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

const LABELS: Record<string, string> = {
  view: 'VIEW',
  drag: 'DRAG',
  explore: 'EXPLORE'
};

@Component({
  selector: 'app-custom-cursor',
  standalone: true,
  templateUrl: './custom-cursor.html',
  styleUrl: './custom-cursor.css'
})
export class CustomCursor implements AfterViewInit, OnDestroy {

  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly cursor = viewChild.required<ElementRef<HTMLElement>>('cursor');

  readonly label = signal<string | null>(null);
  readonly active = signal(typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches);

  private quickX?: (value: number) => void;
  private quickY?: (value: number) => void;

  private readonly onMouseMove = (event: MouseEvent) => {
    this.quickX?.(event.clientX);
    this.quickY?.(event.clientY);
  };

  private readonly onMouseOver = (event: MouseEvent) => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-cursor]');
    this.label.set(target ? LABELS[target.dataset['cursor'] ?? ''] ?? null : null);
  };

  ngAfterViewInit(): void {
    if (!this.active()) {
      return;
    }

    document.body.classList.add('has-custom-cursor');

    const el = this.cursor().nativeElement;
    gsap.set(el, { xPercent: -50, yPercent: -50 });
    const duration = this.reducedMotion.reduced() ? 0 : 0.15;
    this.quickX = gsap.quickTo(el, 'x', { duration, ease: 'power3.out' });
    this.quickY = gsap.quickTo(el, 'y', { duration, ease: 'power3.out' });

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseover', this.onMouseOver);
  }

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseover', this.onMouseOver);
    document.body.classList.remove('has-custom-cursor');
  }
}
