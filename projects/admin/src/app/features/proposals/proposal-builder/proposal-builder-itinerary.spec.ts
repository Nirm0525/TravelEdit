import { APP_BASE_HREF, DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterLink, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalBuilder } from './proposal-builder';
import { ClientTripStep } from './client-trip-step/client-trip-step';
import { PublishChecklist } from './publish-checklist/publish-checklist';
import { AuthService } from '../../../core/services/auth';
import { LeadsService } from '../../../core/services/leads';
import { ProposalImagesService } from '../../../core/services/proposal-images';
import { ProposalsService } from '../../../core/services/proposals';
import { TravelMode } from '../../travel/travel-config';

const content = {
  cover: { title: 'T', subtitle: 'S', imagePath: null },
  welcome: { body: '' },
  intro: { headline: '', body: '' },
  terms: { title: '', body: '' },
  days: [],
  pricing: { lines: [], feesLines: [] },
  travelTips: []
};
const row = {
  id: 'p1', status: 'draft', clientName: 'Persona Ejemplo', clientEmail: 'persona@example.com', leadId: null, destinationText: 'Chile',
  startDate: '2026-11-18', endDate: '2026-11-30', travelersCount: 2, currency: 'USD', accessRequired: true, expiresAt: null,
  publicToken: 't', updatedAt: '2027-01-01T00:00:00Z', acceptedAt: null, acceptedByName: null, content
};

describe('ProposalBuilder — modo itinerario vs propuesta', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<ProposalBuilder>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const tabs = () => Array.from(el().querySelectorAll('.proposal-builder__tab-label')).map((t) => t.textContent?.trim());

  async function render(mode: TravelMode, role = 'staff'): Promise<void> {
    svc = {
      getById: vi.fn().mockResolvedValue({ ...row, kind: mode }),
      getPublishReadiness: vi.fn().mockResolvedValue([]),
      // Un itinerario en borrador consulta SU lista de pendientes (compartir), no la de publicación.
      getItineraryShareReadiness: vi.fn().mockResolvedValue([]),
      hasAccessCode: vi.fn().mockResolvedValue(true)
    };
    await TestBed.configureTestingModule({
      imports: [ProposalBuilder],
      providers: [
        provideRouter([]),
        { provide: APP_BASE_HREF, useValue: '/admin/' },
        { provide: ProposalsService, useValue: svc },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(null) } },
        { provide: AuthService, useValue: { profile: () => ({ fullName: 'Asesora Demo', role }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { mode }, paramMap: convertToParamMap({ id: 'p1' }), queryParamMap: convertToParamMap({}) } }
        }
      ]
    })
      // El paso Client & Trip es el real (contiene Acceso privado); los demás pasos se omiten.
      .overrideComponent(ProposalBuilder, { set: { imports: [RouterLink, DatePipe, PublishChecklist, ClientTripStep], schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
    fixture = TestBed.createComponent(ProposalBuilder);
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  it('itinerario: solo las pestañas de un viaje confirmado', async () => {
    await render('itinerary');
    expect(tabs()).toEqual(['Datos del viaje', 'Portada', 'Itinerario', 'Travel Tips', 'The Edit Assistant']);
  });

  it('itinerario: sin nada comercial ni contractual', async () => {
    await render('itinerary');
    const t = text();
    for (const banned of ['Precios', 'Términos', 'Publicar', 'Despublicar', 'Aceptación', 'aceptada', 'Sí, por favor', 'Comentarios', 'Importar PDF', 'Moneda']) {
      expect(t, banned).not.toContain(banned);
    }
    expect(svc['getPublishReadiness']).not.toHaveBeenCalled();
    expect(svc['getItineraryShareReadiness']).toHaveBeenCalledWith('p1');
  });

  it('itinerario: Datos del viaje con Acceso privado, código y vencimiento', async () => {
    await render('itinerary');
    expect(text()).toContain('Acceso privado');
    expect(text()).toContain('Requiere código de acceso');
    expect(text()).toContain('Expiración (opcional)');
  });

  it('propuesta: conserva Precios, Términos y publicación', async () => {
    await render('proposal');
    expect(tabs()).toContain('Precios');
    expect(tabs()).toContain('Términos');
    expect(text()).toContain('Publicar');
  });

  const openMenu = async () => {
    (el().querySelector('.proposal-builder__menu-trigger') as HTMLButtonElement).click();
    for (let i = 0; i < 4; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const deleteItem = () => el().querySelector('.proposal-builder__menu-item--danger');

  it.each([
    ['proposal', 'admin', true],
    ['proposal', 'editor', false],
    ['proposal', 'staff', false],
    ['itinerary', 'admin', true],
    ['itinerary', 'editor', false],
    ['itinerary', 'staff', false]
  ] as const)('«Eliminar» en %s: %s → %s (solo admin, igual que la RLS)', async (mode, role, visible) => {
    await render(mode, role);
    await openMenu();
    expect(!!deleteItem()).toBe(visible);
  });
});
