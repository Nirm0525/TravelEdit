import { AfterViewInit, Component, ElementRef, OnDestroy, computed, inject, signal, viewChild } from '@angular/core';
import { NgFor } from '@angular/common';
import { DESTINATIONS, Destination } from '../../core/data/destinations';
import { DestinationCard } from './destination-card/destination-card';
import { SectionTitle } from '../../shared/ui/section-title/section-title';
import { Draggable, gsap, registerGsap } from '../../core/gsap/gsap-setup';
import { ReducedMotionService } from '../../core/services/reduced-motion';

@Component({
  selector: 'app-destinations',
  standalone: true,
  imports: [DestinationCard, SectionTitle, NgFor],
  templateUrl: './destinations.html',
  styleUrl: './destinations.css'
})
export class Destinations implements AfterViewInit, OnDestroy {
  readonly destinations = DESTINATIONS;

  trackBySlug(_index: number, destination: Destination): string {
    return destination.slug;
  }

  private readonly reducedMotion = inject(ReducedMotionService);
  private readonly viewport = viewChild<ElementRef<HTMLElement>>('viewport');
  private readonly track = viewChild<ElementRef<HTMLElement>>('track');
  private draggable?: Draggable;

  readonly progress = signal(0);
  readonly atStart = computed(() => this.progress() <= 0.001);
  readonly atEnd = computed(() => this.progress() >= 0.999);

  private bounds = () => ({ minX: 0, maxX: 0 });
  private hoverDirection = 0;
  private hoverSpeed = 0;
  private readonly hoverEdge = 0.28;
  private readonly hoverMaxSpeed = 9;
  private readonly tickHover = () => this.updateHoverScroll();

  ngAfterViewInit(): void {
    const viewportEl = this.viewport()?.nativeElement;
    const trackEl = this.track()?.nativeElement;
    if (!viewportEl || !trackEl) {
      return;
    }

    registerGsap();

    this.bounds = () => ({
      minX: Math.min(0, viewportEl.clientWidth - trackEl.scrollWidth),
      maxX: 0
    });

    [this.draggable] = Draggable.create(trackEl, {
      type: 'x',
      inertia: !this.reducedMotion.reduced(),
      bounds: this.bounds(),
      edgeResistance: 0.85,
      onDrag: () => this.updateProgress(),
      onThrowUpdate: () => this.updateProgress()
    });

    gsap.ticker.add(this.tickHover);
  }

  ngOnDestroy(): void {
    gsap.ticker.remove(this.tickHover);
    this.draggable?.kill();
  }

  onViewportPointerMove(event: MouseEvent): void {
    const viewportEl = this.viewport()?.nativeElement;
    if (!viewportEl) {
      return;
    }

    const rect = viewportEl.getBoundingClientRect();
    const relX = (event.clientX - rect.left) / rect.width;

    if (relX < this.hoverEdge) {
      this.hoverDirection = -1;
      this.hoverSpeed = (this.hoverEdge - relX) / this.hoverEdge;
    } else if (relX > 1 - this.hoverEdge) {
      this.hoverDirection = 1;
      this.hoverSpeed = (relX - (1 - this.hoverEdge)) / this.hoverEdge;
    } else {
      this.hoverDirection = 0;
      this.hoverSpeed = 0;
    }
  }

  onViewportPointerLeave(): void {
    this.hoverDirection = 0;
    this.hoverSpeed = 0;
  }

  private updateHoverScroll(): void {
    if (!this.hoverDirection || this.reducedMotion.reduced()) {
      return;
    }

    const draggable = this.draggable;
    const trackEl = this.track()?.nativeElement;
    if (!draggable || !trackEl || draggable.isDragging) {
      return;
    }

    const { minX, maxX } = this.bounds();
    const dx = -this.hoverDirection * this.hoverSpeed * this.hoverMaxSpeed;
    const next = gsap.utils.clamp(minX, maxX, draggable.x + dx);
    if (next === draggable.x) {
      return;
    }

    gsap.set(trackEl, { x: next });
    draggable.update();
    this.updateProgress();
  }

  scrollBy(direction: 1 | -1): void {
    const draggable = this.draggable;
    const trackEl = this.track()?.nativeElement;
    const viewportEl = this.viewport()?.nativeElement;
    if (!draggable || !trackEl || !viewportEl) {
      return;
    }

    const { minX, maxX } = this.bounds();
    const step = viewportEl.clientWidth * 0.9;
    const target = gsap.utils.clamp(minX, maxX, draggable.x - direction * step);

    gsap.to(trackEl, {
      x: target,
      duration: this.reducedMotion.reduced() ? 0 : 0.6,
      ease: 'power3.out',
      onUpdate: () => {
        draggable.update();
        this.updateProgress();
      }
    });
  }

  private updateProgress(): void {
    const { minX } = this.bounds();
    const range = -minX;
    const value = range <= 0 ? 0 : -(this.draggable?.x ?? 0) / range;
    this.progress.set(Math.min(1, Math.max(0, value)));
  }
}
