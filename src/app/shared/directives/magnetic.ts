import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';
import { gsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

function toStrength(value: unknown): number {
  const parsed = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isNaN(parsed) ? 0.25 : parsed;
}

@Directive({
  selector: '[appMagnetic]',
  standalone: true
})
export class MagneticDirective {

  private readonly el = inject(ElementRef<HTMLElement>);
  private readonly reducedMotion = inject(ReducedMotionService);

  readonly strength = input(0.25, { alias: 'appMagnetic', transform: toStrength });

  private readonly quickX = gsap.quickTo(this.el.nativeElement, 'x', { duration: 0.5, ease: 'power3.out' });
  private readonly quickY = gsap.quickTo(this.el.nativeElement, 'y', { duration: 0.5, ease: 'power3.out' });

  @HostListener('mousemove', ['$event'])
  onMouseMove(event: MouseEvent): void {
    if (this.reducedMotion.reduced() || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
      return;
    }

    const rect = this.el.nativeElement.getBoundingClientRect();
    const offsetX = event.clientX - (rect.left + rect.width / 2);
    const offsetY = event.clientY - (rect.top + rect.height / 2);

    this.quickX(offsetX * this.strength());
    this.quickY(offsetY * this.strength());
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    this.quickX(0);
    this.quickY(0);
  }
}
