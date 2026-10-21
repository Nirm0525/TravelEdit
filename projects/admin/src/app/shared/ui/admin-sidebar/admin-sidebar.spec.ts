import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AdminSidebar } from './admin-sidebar';
import { AuthService } from '../../../core/services/auth';
import { TRAVEL_FEATURES } from '../../../features/travel/travel-config';

describe('AdminSidebar — grupo Viajes', () => {
  let fixture: ComponentFixture<AdminSidebar>;
  const el = () => fixture.nativeElement as HTMLElement;
  const group = () => el().querySelector<HTMLButtonElement>('.admin-sidebar__group-trigger');
  const sublinks = () => Array.from(el().querySelectorAll('.admin-sidebar__sublink')).map((a) => a.textContent?.trim());

  async function setup(role: string | null, itineraries = false) {
    localStorage.removeItem('travel-edit-admin-sidebar-collapsed');
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: { profile: signal(role ? { role, fullName: 'Persona Ejemplo' } : null), signOut: async () => {} } },
        { provide: TRAVEL_FEATURES, useValue: { itinerariesEnabled: itineraries } }
      ]
    });
    fixture = TestBed.createComponent(AdminSidebar);
    fixture.detectChanges();
  }

  it('muestra «Viajes» después de Solicitudes y ya no hay un enlace suelto a Propuestas', async () => {
    await setup('staff');
    const labels = Array.from(el().querySelectorAll('.admin-sidebar__nav > a, .admin-sidebar__nav > .admin-sidebar__group .admin-sidebar__group-trigger')).map((n) => n.textContent?.trim());
    expect(labels.indexOf('Viajes')).toBe(labels.indexOf('Solicitudes') + 1);
    expect(labels).not.toContain('Propuestas');
  });

  it('con Itinerarios apagado solo ofrece Propuestas', async () => {
    await setup('admin');
    group()!.click();
    fixture.detectChanges();
    expect(sublinks()).toEqual(['Propuestas']);
  });

  it('con Itinerarios encendido ofrece ambos', async () => {
    await setup('admin', true);
    group()!.click();
    fixture.detectChanges();
    expect(sublinks()).toEqual(['Propuestas', 'Itinerarios']);
  });

  it('el botón expone aria-expanded y aria-controls y alterna', async () => {
    await setup('admin');
    expect(group()!.getAttribute('aria-expanded')).toBe('false');
    group()!.click();
    fixture.detectChanges();
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
    expect(el().querySelector('#' + group()!.getAttribute('aria-controls'))).not.toBeNull();
    group()!.click();
    fixture.detectChanges();
    expect(group()!.getAttribute('aria-expanded')).toBe('false');
  });

  it('dentro de /viajes el grupo está abierto y activo, y no se cierra', async () => {
    await setup('admin');
    await TestBed.inject(Router).navigateByUrl('/viajes/propuestas/abc/edit');
    fixture.detectChanges();
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
    expect(group()!.classList.contains('is-active')).toBe(true);
    group()!.click();
    fixture.detectChanges();
    expect(group()!.getAttribute('aria-expanded')).toBe('true');
  });

  it('con el menú contraído, el clic lo expande', async () => {
    await setup('admin');
    fixture.componentInstance.collapsed.set(true);
    fixture.detectChanges();
    group()!.click();
    fixture.detectChanges();
    expect(fixture.componentInstance.collapsed()).toBe(false);
    expect(sublinks()).toEqual(['Propuestas']);
  });
});
