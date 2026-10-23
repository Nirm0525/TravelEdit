import { APP_BASE_HREF, DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, RouterLink, convertToParamMap, provideRouter } from '@angular/router';
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
const row = (kind: TravelMode) => ({
  id: 'p1', kind, status: 'draft', clientName: 'Persona Ejemplo', clientEmail: 'persona@example.com', leadId: null, destinationText: 'Chile',
  startDate: '2026-11-18', endDate: '2026-11-30', travelersCount: 2, currency: 'USD', accessRequired: true, expiresAt: null,
  publicToken: 't', updatedAt: '2027-01-01T00:00:00Z', acceptedAt: null, acceptedByName: null, content
});

describe('ProposalBuilder — el kind de la fila manda sobre la ruta', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let navigate: ReturnType<typeof vi.spyOn>;
  let fixture: ComponentFixture<ProposalBuilder>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const tabs = () => Array.from(el().querySelectorAll('.proposal-builder__tab-label')).map((t) => t.textContent?.trim());

  async function render(routeMode: TravelMode, dbKind: TravelMode, query: Record<string, string> = {}, role = 'admin'): Promise<void> {
    svc = {
      getById: vi.fn().mockResolvedValue(row(dbKind)),
      getPublishReadiness: vi.fn().mockResolvedValue([]),
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
          useValue: { snapshot: { data: { mode: routeMode }, paramMap: convertToParamMap({ id: 'p1' }), queryParamMap: convertToParamMap(query) } }
        }
      ]
    })
      .overrideComponent(ProposalBuilder, { set: { imports: [RouterLink, DatePipe, PublishChecklist, ClientTripStep], schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(ProposalBuilder);
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  it('ruta de propuestas + fila itinerary: redirige a /viajes/itinerarios conservando id y ?step, y NO pinta una propuesta', async () => {
    await render('proposal', 'itinerary', { step: 'journey' });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'p1', 'edit'], { queryParams: { step: 'journey' }, replaceUrl: true });
    expect(tabs()).toEqual([]);
    for (const banned of ['Precios', 'Términos', 'Publicar', 'Client & Trip']) {
      expect(text(), banned).not.toContain(banned);
    }
    expect(svc['getPublishReadiness']).not.toHaveBeenCalled();
  });

  it('ruta de itinerarios + fila proposal: redirige a /viajes/propuestas y NO pinta un itinerario', async () => {
    await render('itinerary', 'proposal', { step: 'cover' });
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'p1', 'edit'], { queryParams: { step: 'cover' }, replaceUrl: true });
    expect(tabs()).toEqual([]);
    expect(text()).not.toContain('Datos del viaje');
  });

  it('conserva todos los query params (también varios valores), no solo step', async () => {
    await render('proposal', 'itinerary', { step: 'travel-tips', utm_source: 'mail' });
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'p1', 'edit'], {
      queryParams: { step: 'travel-tips', utm_source: 'mail' },
      replaceUrl: true
    });
  });

  it('sin query params redirige con un objeto vacío', async () => {
    await render('proposal', 'itinerary');
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'p1', 'edit'], { queryParams: {}, replaceUrl: true });
  });

  it('mientras redirige no muestra el aviso de «no encontrada» ni el error de carga', async () => {
    await render('proposal', 'itinerary');
    expect(text()).not.toContain('No se encontró');
    expect(text()).not.toContain('No se pudo cargar');
  });

  it('ruta y fila coinciden (itinerary): no redirige y muestra las pestañas del itinerario', async () => {
    await render('itinerary', 'itinerary');
    expect(navigate).not.toHaveBeenCalled();
    expect(tabs()).toEqual(['Datos del viaje', 'Portada', 'Itinerario', 'Travel Tips', 'The Edit Assistant']);
  });

  it('ruta y fila coinciden (proposal): no redirige y conserva todas las pestañas', async () => {
    await render('proposal', 'proposal');
    expect(navigate).not.toHaveBeenCalled();
    expect(tabs()).toEqual(['Client & Trip', 'Portada', 'Itinerario', 'Precios', 'Travel Tips', 'Términos', 'The Edit Assistant']);
  });

  it('fila itinerary REAL: sin Precios, Términos, Publicar/Despublicar, Aceptación, «Sí, por favor», comentarios de cotización ni Importar PDF', async () => {
    await render('itinerary', 'itinerary');
    const t = text();
    for (const banned of ['Precios', 'Términos', 'Publicar', 'Despublicar', 'Aceptación', 'aceptada', 'Sí, por favor', 'Comentarios', 'Importar PDF', 'Moneda', 'Enviar al cliente']) {
      expect(t, banned).not.toContain(banned);
    }
    expect(svc['getPublishReadiness']).not.toHaveBeenCalled();
  });

  it('fila proposal REAL: conserva publicación y precios', async () => {
    await render('proposal', 'proposal');
    expect(text()).toContain('Publicar');
    expect(svc['getPublishReadiness']).toHaveBeenCalled();
  });
});
