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

  // El efecto magnético mueve el elemento con transform mientras el mouse
  // está encima. Si ese movimiento desplaza el elemento entre el mousedown y
  // el mouseup de un clic, el navegador nunca sintetiza el evento "click"
  // (requiere que ambos caigan sobre el mismo elemento) — el botón se queda
  // sin responder aunque el usuario sí le haya dado clic. Capturar el
  // puntero en mousedown fija todos los eventos siguientes a este elemento
  // sin importar hacia dónde se desplace visualmente.
  @HostListener('pointerdown', ['$event'])
  onPointerDown(event: PointerEvent): void {
    this.el.nativeElement.setPointerCapture(event.pointerId);
  }

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
