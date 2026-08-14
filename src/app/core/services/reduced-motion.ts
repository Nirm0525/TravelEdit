import { Injectable, signal } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ReducedMotionService {

  private readonly query = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

  readonly reduced = signal(this.query?.matches ?? false);

  constructor() {
    this.query?.addEventListener('change', (event) => this.reduced.set(event.matches));
  }
}
