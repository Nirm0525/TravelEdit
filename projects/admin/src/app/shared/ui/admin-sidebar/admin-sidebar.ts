import { Component, computed, inject, model, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { PermissionKey, canAccess } from '../../../core/data/permissions';

interface NavItem {
  label: string;
  path: string;
  icon: 'dashboard' | 'home' | 'compass' | 'inbox' | 'users';
  permission: PermissionKey;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard', permission: 'dashboard' },
  { label: 'Página principal', path: '/contenido/hero', icon: 'home', permission: 'contenido' },
  { label: 'Destinos', path: '/destinos', icon: 'compass', permission: 'destinos' },
  { label: 'Solicitudes', path: '/solicitudes', icon: 'inbox', permission: 'solicitudes' },
  { label: 'Usuarios', path: '/usuarios', icon: 'users', permission: 'usuarios' }
];

const COLLAPSE_STORAGE_KEY = 'travel-edit-admin-sidebar-collapsed';

@Component({
  selector: 'app-admin-sidebar',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './admin-sidebar.html',
  styleUrl: './admin-sidebar.css'
})
export class AdminSidebar {
  private readonly auth = inject(AuthService);

  readonly navItems = computed(() => {
    const role = this.auth.profile()?.role;
    return NAV_ITEMS.filter((item) => canAccess(role, item.permission));
  });

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
