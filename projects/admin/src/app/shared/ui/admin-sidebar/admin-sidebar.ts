import { Component, ElementRef, HostListener, computed, effect, inject, model, signal, viewChild } from '@angular/core';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { PermissionKey, canAccess } from '../../../core/data/permissions';
import { STAFF_ROLE_LABEL, StaffRole } from '../../../core/models/staff-role';

interface NavItem {
  label: string;
  path: string;
  icon: 'dashboard' | 'home' | 'book' | 'compass' | 'inbox' | 'users' | 'settings';
  permission: PermissionKey;
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard', permission: 'dashboard' },
  { label: 'Página principal', path: '/contenido', icon: 'home', permission: 'contenido' },
  { label: 'Blog', path: '/blog', icon: 'book', permission: 'blog' },
  { label: 'Destinos', path: '/destinos', icon: 'compass', permission: 'destinos' },
  { label: 'Solicitudes', path: '/solicitudes', icon: 'inbox', permission: 'solicitudes' },
  { label: 'Usuarios', path: '/usuarios', icon: 'users', permission: 'usuarios' },
  { label: 'Configuración', path: '/configuracion', icon: 'settings', permission: 'configuracion' }
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
  private readonly router = inject(Router);
  private readonly userMenu = viewChild<ElementRef<HTMLElement>>('userMenu');

  readonly profile = this.auth.profile;
  readonly userMenuOpen = signal(false);

  readonly navItems = computed(() => {
    const role = this.auth.profile()?.role;
    return NAV_ITEMS.filter((item) => canAccess(role, item.permission));
  });

  readonly mobileOpen = model(false);
  readonly collapsed = signal(this.readStoredCollapsed());

  constructor() {
    // El sidebar móvil es un overlay de pantalla completa — sin esto, la
    // página de atrás sigue siendo scrolleable debajo del overlay.
    effect(() => {
      document.body.classList.toggle('mobile-sidebar-open', this.mobileOpen());
    });
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    localStorage.setItem(COLLAPSE_STORAGE_KEY, String(next));
  }

  closeMobile(): void {
    this.mobileOpen.set(false);
  }

  roleLabel(role: StaffRole): string {
    return STAFF_ROLE_LABEL[role];
  }

  initial(fullName: string): string {
    return fullName.trim().charAt(0).toUpperCase();
  }

  toggleUserMenu(): void {
    this.userMenuOpen.update((open) => !open);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.userMenuOpen()) {
      return;
    }
    const container = this.userMenu()?.nativeElement;
    if (container && !container.contains(event.target as Node)) {
      this.userMenuOpen.set(false);
    }
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.userMenuOpen.set(false);
    this.mobileOpen.set(false);
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  private readStoredCollapsed(): boolean {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
  }
}
