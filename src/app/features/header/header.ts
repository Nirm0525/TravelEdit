import { Component, HostListener, inject, signal } from '@angular/core';
import { NAV_ITEMS } from '../../core/data/nav';
import { AnimatedButton } from '../../shared/ui/animated-button/animated-button';
import { TravelEditFormService } from '../../core/services/travel-edit-form';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [AnimatedButton],
  templateUrl: './header.html',
  styleUrl: './header.css'
})
export class Header {
  private readonly travelEditForm = inject(TravelEditFormService);

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
  }

  closeMenu(): void {
    this.menuOpen.set(false);
  }

  openTravelEditForm(): void {
    this.menuOpen.set(false);
    this.travelEditForm.open();
  }
}
