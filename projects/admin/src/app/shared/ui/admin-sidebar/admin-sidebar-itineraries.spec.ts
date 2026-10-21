import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminSidebar } from './admin-sidebar';
import { AuthService } from '../../../core/services/auth';

/** Con el flag REAL (sin sobrescribir TRAVEL_FEATURES): Viajes ofrece Propuestas e Itinerarios en cada forma del menú. */
describe('AdminSidebar — Viajes con Itinerarios activo (flag real)', () => {
  let fixture: ComponentFixture<AdminSidebar>;
  const el = () => fixture.nativeElement as HTMLElement;
  const group = () => el().querySelector<HTMLButtonElement>('.admin-sidebar__group-trigger');
  const sublinks = () => Array.from(el().querySelectorAll('.admin-sidebar__sublink')).map((a) => a.textContent?.trim());
  const hrefs = () => Array.from(el().querySelectorAll('.admin-sidebar__sublink')).map((a) => a.getAttribute('href'));

  function setup(role: string): void {
    localStorage.removeItem('travel-edit-admin-sidebar-collapsed');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: { profile: signal({ role, fullName: 'Persona Ejemplo' }), signOut: async () => {} } }
      ]
    });
    fixture = TestBed.createComponent(AdminSidebar);
    fixture.detectChanges();
  }

  it.each(['admin', 'editor', 'staff'])('escritorio: %s ve Viajes > Propuestas e Itinerarios, con sus rutas', (role) => {
    setup(role);
    group()!.click();
    fixture.detectChanges();
    expect(sublinks()).toEqual(['Propuestas', 'Itinerarios']);
    expect(hrefs()).toEqual(['/viajes/propuestas', '/viajes/itinerarios']);
  });

  it('menú contraído: un clic en Viajes lo expande y muestra ambos', () => {
    setup('admin');
    fixture.componentInstance.collapsed.set(true);
    fixture.detectChanges();
    group()!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(sublinks()).toEqual(['Propuestas', 'Itinerarios']);
  });

  it('móvil (cajón abierto): el grupo Viajes ofrece ambos y navegar cierra el cajón', async () => {
    setup('staff');
    fixture.componentInstance.mobileOpen.set(true);
    fixture.detectChanges();
    expect(document.body.classList.contains('mobile-sidebar-open')).toBe(true);
    group()!.click();
    fixture.detectChanges();
    expect(sublinks()).toEqual(['Propuestas', 'Itinerarios']);
    (el().querySelectorAll('.admin-sidebar__sublink')[1] as HTMLAnchorElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.mobileOpen()).toBe(false);
  });

  it('dentro de /viajes/itinerarios el grupo está abierto y activo, y Propuestas no queda marcado', async () => {
    setup('admin');
    await TestBed.inject(Router).navigateByUrl('/viajes/itinerarios/abc/edit');
    // routerLinkActive se recalcula tras la navegación: hace falta un ciclo de detección más.
    await fixture.whenStable();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
    expect(group()!.classList.contains('is-active')).toBe(true);
    const active = Array.from(el().querySelectorAll('.admin-sidebar__sublink.is-active')).map((a) => a.textContent?.trim());
    expect(active).toEqual(['Itinerarios']);
  });
});
