import { APP_BASE_HREF } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { vi } from 'vitest';
import { AuthService } from '../../core/services/auth';
import { LeadsService } from '../../core/services/leads';
import { ProposalImagesService } from '../../core/services/proposal-images';
import { ProposalsService } from '../../core/services/proposals';
import { ProposalBuilder } from '../proposals/proposal-builder/proposal-builder';
import { TRAVEL_FEATURES } from './travel-config';
import { LEGACY_PROPOSAL_REDIRECTS, travelRoutes } from './travel-routes';

const content = {
  cover: { title: 'T', subtitle: '', imagePath: null }, welcome: { body: '' }, intro: { headline: '', body: '' }, terms: { title: '', body: '' },
  days: [], pricing: { lines: [], feesLines: [] }, travelTips: []
};
const row = (kind: 'proposal' | 'itinerary') => ({
  id: 'p1', kind, status: 'draft', clientName: 'Persona Ejemplo', clientEmail: null, leadId: null, destinationText: null, startDate: null, endDate: null,
  travelersCount: null, currency: 'USD', accessRequired: false, expiresAt: null, publicToken: 't', updatedAt: '2027-01-01T00:00:00Z',
  acceptedAt: null, acceptedByName: null, content
});

/** El enlace antiguo de un correo, de punta a punta: ruta legacy → ruta de propuestas → el builder lee la fila y corrige al kind REAL. */
describe('Ruta legacy encadenada: /proposals/:id/edit → /viajes/… según el kind de la fila', () => {
  let resolveRow: (value: unknown) => void;
  let getById: ReturnType<typeof vi.fn>;
  let navigateSpy: ReturnType<typeof vi.spyOn>;
  let harness: RouterTestingHarness;

  async function setup(kind: 'proposal' | 'itinerary'): Promise<void> {
    // jsdom no trae matchMedia (lo usa el editor de texto enriquecido del paso real).
    window.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined })) as never;
    // La lectura de la fila queda en suspenso hasta que la prueba la libera: así se puede mirar la transición.
    // Solo la PRIMERA lectura queda en suspenso; la del builder al que se redirige (si la hay) responde enseguida.
    let reads = 0;
    getById = vi.fn(() => (++reads === 1 ? new Promise((resolve) => (resolveRow = () => resolve(row(kind)))) : Promise.resolve(row(kind))));
    TestBed.configureTestingModule({
      providers: [
        provideRouter([...travelRoutes('proposal'), ...travelRoutes('itinerary'), ...LEGACY_PROPOSAL_REDIRECTS, { path: '**', children: [] }]),
        { provide: APP_BASE_HREF, useValue: '/admin/' },
        { provide: TRAVEL_FEATURES, useValue: { itinerariesEnabled: true } },
        { provide: AuthService, useValue: { ready: async () => undefined, profile: () => ({ role: 'admin', fullName: 'Asesora Demo' }) } },
        { provide: ProposalsService, useValue: { getById, getPublishReadiness: vi.fn().mockResolvedValue([]), hasAccessCode: vi.fn().mockResolvedValue(false) } },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(null) } }
      ]
    });
    // Los pasos hijos no son el objeto de esta prueba (cargan sus propios datos): se omiten, como en los demás specs del builder.
    TestBed.overrideComponent(ProposalBuilder, { set: { schemas: [NO_ERRORS_SCHEMA] } });
    harness = await RouterTestingHarness.create();
    navigateSpy = vi.spyOn(TestBed.inject(Router), 'navigate');
  }

  const tabs = () => Array.from((harness.routeNativeElement as HTMLElement).querySelectorAll('.proposal-builder__tab-label')).map((t) => t.textContent?.trim());
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      await harness.fixture.whenStable();
      harness.detectChanges();
    }
  };

  it('itinerary: legacy → /viajes/propuestas (sin pintar el builder) → /viajes/itinerarios, con id y TODOS los query params', async () => {
    await setup('itinerary');
    const router = TestBed.inject(Router);

    await harness.navigateByUrl('/proposals/p1/edit?step=itinerary&foo=bar');
    await flush();
    // 1) La redirección legacy ya llevó a Propuestas, conservando id y query; la fila aún no llegó.
    expect(router.url).toBe('/viajes/propuestas/p1/edit?step=itinerary&foo=bar');
    expect(getById).toHaveBeenCalledWith('p1');
    // 2) Durante la transición NO se renderiza el builder con el modo equivocado (ni pestañas de propuesta ni de itinerario).
    expect(tabs()).toEqual([]);
    expect((harness.routeNativeElement as HTMLElement).textContent).not.toContain('Precios');
    expect(navigateSpy).not.toHaveBeenCalled();

    // 3) Llega la fila: kind = itinerary → el builder corrige a Itinerarios.
    resolveRow(undefined);
    await flush();
    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith(['/viajes/itinerarios', 'p1', 'edit'], { queryParams: { step: 'itinerary', foo: 'bar' }, replaceUrl: true });
    expect(router.url).toBe('/viajes/itinerarios/p1/edit?step=itinerary&foo=bar');
  });

  it('itinerary: tras la corrección el builder se pinta en MODO ITINERARIO (nunca con las pestañas de propuesta)', async () => {
    await setup('itinerary');
    await harness.navigateByUrl('/proposals/p1/edit?step=itinerary&foo=bar');
    await flush();
    resolveRow(undefined);
    await flush();
    // El builder de la ruta nueva (otra instancia) vuelve a leer la fila y ahora coincide.
    expect(getById.mock.calls.length).toBeGreaterThanOrEqual(2); // el builder nuevo (y sus pasos) leen la fila
    expect(tabs()).toEqual(['Datos del viaje', 'Portada', 'Itinerario', 'Travel Tips', 'The Edit Assistant']);
  });

  it('proposal: legacy → /viajes/propuestas y se queda ahí (la fila coincide: no hay segunda redirección)', async () => {
    await setup('proposal');
    const router = TestBed.inject(Router);
    await harness.navigateByUrl('/proposals/p1/edit?step=itinerary&foo=bar');
    await flush();
    resolveRow(undefined);
    await flush();
    expect(navigateSpy).not.toHaveBeenCalled();
    expect(router.url).toBe('/viajes/propuestas/p1/edit?step=itinerary&foo=bar');
    expect(tabs()).toContain('Precios');
  });

  it('la redirección del builder reemplaza la entrada del historial (replaceUrl) para que «Atrás» no vuelva a la ruta equivocada', async () => {
    await setup('itinerary');
    await harness.navigateByUrl('/proposals/p1/edit?step=cover');
    await flush();
    resolveRow(undefined);
    await flush();
    expect(navigateSpy.mock.calls[0][1]).toMatchObject({ replaceUrl: true });
  });
});
