import { Component, HostListener, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { NAV_ITEMS } from '../../core/data/nav';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class Header {
  private readonly router = inject(Router);

  readonly navItems = NAV_ITEMS;
  readonly scrolled = signal(false);
  readonly menuOpen = signal(false);
  readonly hoveredImage = signal<string | null>(null);

  @HostListener('window:scroll')
  onScroll(): void {
    this.scrolled.set(window.scrollY > 60);
  }

  toggleMenu(): void {
    this.menuOpen.update((open) => !open);
    this.syncBodyScrollLock();
  }

  closeMenu(): void {
    this.menuOpen.set(false);
    this.syncBodyScrollLock();
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.menuOpen()) {
      this.closeMenu();
    }
  }

  // El menú móvil es un overlay de pantalla completa — sin esto, la página de
  // atrás sigue siendo scrolleable debajo (visible como salto/rebote en iOS).
  private syncBodyScrollLock(): void {
    document.body.classList.toggle('mobile-menu-open', this.menuOpen());
  }

  openTravelEditForm(): void {
    this.menuOpen.set(false);
    void this.router.navigate(['/disenar-tu-viaje']);
  }
}
