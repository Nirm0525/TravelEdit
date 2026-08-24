import { Component, model, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  label: string;
  path: string;
  icon: 'dashboard' | 'home' | 'compass' | 'inbox';
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard' },
  { label: 'Página principal', path: '/contenido/hero', icon: 'home' },
  { label: 'Destinos', path: '/destinos', icon: 'compass' },
  { label: 'Solicitudes', path: '/solicitudes', icon: 'inbox' }
];

const COLLAPSE_STORAGE_KEY = 'travel-edit-admin-sidebar-collapsed';

@Component({
  selector: 'app-admin-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './admin-sidebar.html',
  styleUrl: './admin-sidebar.css'
})
export class AdminSidebar {
  readonly navItems = NAV_ITEMS;
  readonly mobileOpen = model(false);
  readonly collapsed = signal(this.readStoredCollapsed());

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }

  private readStoredCollapsed(): boolean {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
  }
}
