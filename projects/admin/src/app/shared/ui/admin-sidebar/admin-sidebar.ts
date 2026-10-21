import { NgTemplateOutlet } from '@angular/common';
import { Component, DestroyRef, ElementRef, HostListener, computed, effect, inject, model, signal, viewChild } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../../core/services/auth';
import { PermissionCode, PermissionKey, can, canAccess } from '../../../core/data/permissions';
import { TRAVEL_FEATURES, TravelMode, isTravelModeEnabled, travelConfigOf } from '../../../features/travel/travel-config';
import { STAFF_ROLE_LABEL, StaffRole } from '../../../core/models/staff-role';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

type NavIcon = 'dashboard' | 'home' | 'book' | 'compass' | 'inbox' | 'document' | 'trips' | 'users' | 'settings';

interface NavItem {
  label: string;
  path: string;
  icon: NavIcon;
  permission: PermissionKey;
}

/** Subitem de un grupo: se muestra solo si su modo está habilitado Y la persona tiene el permiso. */
interface NavChild {
  label: string;
  path: string;
  mode: TravelMode;
  permission: PermissionCode;
}

/** Grupo desplegable. Sin hijos visibles, el grupo no aparece. */
interface NavGroup {
  id: string;
  label: string;
  icon: NavIcon;
  /** Prefijo de URL: estar dentro de cualquier ruta que empiece así mantiene el grupo abierto y activo. */
  pathPrefix: string;
  children: NavChild[];
}

export type NavEntry = ({ kind: 'link' } & NavItem) | ({ kind: 'group' } & Omit<NavGroup, 'children'> & { children: NavChild[] });

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: '/dashboard', icon: 'dashboard', permission: 'dashboard' },
  { label: 'Página principal', path: '/contenido', icon: 'home', permission: 'contenido' },
  { label: 'Blog', path: '/blog', icon: 'book', permission: 'blog' },
  { label: 'Destinos', path: '/destinos', icon: 'compass', permission: 'destinos' },
  { label: 'Solicitudes', path: '/solicitudes', icon: 'inbox', permission: 'solicitudes' },
  { label: 'Usuarios', path: '/usuarios', icon: 'users', permission: 'usuarios' },
  { label: 'Configuración', path: '/configuracion', icon: 'settings', permission: 'configuracion' }
];

/** Viajes agrupa Propuestas e Itinerarios; se coloca justo después de Solicitudes. */
const TRAVEL_GROUP: NavGroup = {
  id: 'viajes',
  label: 'Viajes',
  icon: 'trips',
  pathPrefix: '/viajes',
  children: (['proposal', 'itinerary'] as const).map((mode) => {
    const config = travelConfigOf(mode);
    return { label: config.labels.plural, path: config.routeBase, mode, permission: config.permissions.view };
  })
};

const COLLAPSE_STORAGE_KEY = 'travel-edit-admin-sidebar-collapsed';

@Component({
  selector: 'app-admin-sidebar',
  imports: [NgTemplateOutlet, RouterLink, RouterLinkActive],
  templateUrl: './admin-sidebar.html',
  styleUrl: './admin-sidebar.css'
})
export class AdminSidebar {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly userMenu = viewChild<ElementRef<HTMLElement>>('userMenu');

  readonly profile = this.auth.profile;
  readonly userMenuOpen = signal(false);

  private readonly features = inject(TRAVEL_FEATURES);
  private readonly destroyRef = inject(DestroyRef);

  /** Entradas del menú en orden: enlaces simples y el grupo «Viajes» (tras Solicitudes) con los hijos que corresponden. */
  readonly navEntries = computed<NavEntry[]>(() => {
    const role = this.auth.profile()?.role;
    const entries: NavEntry[] = [];
    for (const item of NAV_ITEMS) {
      if (canAccess(role, item.permission)) {
        entries.push({ kind: 'link', ...item });
      }
      if (item.path === '/solicitudes') {
        const children = TRAVEL_GROUP.children.filter((child) => isTravelModeEnabled(child.mode, this.features) && can(role, child.permission));
        if (children.length > 0) {
          entries.push({ kind: 'group', ...TRAVEL_GROUP, children });
        }
      }
    }
    return entries;
  });

  /** URL actual (se actualiza en cada navegación): decide si un grupo está activo, y por tanto abierto. */
  private readonly currentUrl = signal(this.router.url);
  private readonly manuallyOpen = signal(false);
  readonly isGroupActive = (group: { pathPrefix: string }) => (this.currentUrl().split('?')[0] ?? '').startsWith(group.pathPrefix);
  /** Abierto si estás dentro de alguno de sus hijos (no se puede cerrar desde dentro) o si lo abriste a mano. */
  readonly isGroupOpen = (group: { pathPrefix: string }) => this.isGroupActive(group) || this.manuallyOpen();

  readonly mobileOpen = model(false);
  readonly collapsed = signal(this.readStoredCollapsed());

  constructor() {
    this.router.events.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((event) => {
      if (event instanceof NavigationEnd) {
        this.currentUrl.set(event.urlAfterRedirects);
      }
    });

    // El sidebar móvil es un overlay de pantalla completa — sin esto, la
    // página de atrás sigue siendo scrolleable debajo del overlay.
    effect(() => {
      document.body.classList.toggle('mobile-sidebar-open', this.mobileOpen());
    });
  }

  /**
   * Abre o cierra el grupo. Con el menú contraído (solo iconos) no hay dónde mostrar los hijos: el clic lo expande.
   * Dentro del grupo (una de sus rutas activa) permanece abierto.
   */
  toggleGroup(): void {
    if (this.collapsed()) {
      this.collapsed.set(false);
      localStorage.setItem(COLLAPSE_STORAGE_KEY, 'false');
      this.manuallyOpen.set(true);
      return;
    }
    this.manuallyOpen.update((open) => !open);
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
    // navigateByUrl() puede quedar bloqueado por un canDeactivate (p. ej.
    // unsavedChangesGuard en un editor con cambios sin guardar) — pero la
    // sesión YA se cerró en ese punto, así que dejar a la persona en la
    // misma pantalla sería un estado roto (viendo una página protegida sin
    // sesión real). Cerrar sesión es una acción explícita: si el router la
    // bloquea, se fuerza una navegación dura que ningún guard puede detener.
    const navigated = await this.router.navigateByUrl('/login');
    if (!navigated) {
      window.location.href = new URL('login', document.baseURI).toString();
    }
  }

  private readStoredCollapsed(): boolean {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === 'true';
  }
}
