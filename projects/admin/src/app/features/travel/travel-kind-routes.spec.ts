import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, provideRouter } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { TRAVEL_FEATURES, travelPaths } from './travel-config';
import { LEGACY_PROPOSAL_REDIRECTS, travelRoutes } from './travel-routes';

@Component({ template: '' })
class Stub {}

/** Hoja activa del árbol de rutas, para ver QUÉ ruta resolvió una URL. */
const leaf = (router: Router): ActivatedRouteSnapshot => {
  let node = router.routerState.snapshot.root;
  while (node.firstChild) {
    node = node.firstChild;
  }
  return node;
};

describe('Viajes — rutas por modo', () => {
  async function setup(itinerariesEnabled: boolean, role: string | null = 'admin'): Promise<Router> {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          ...travelRoutes('proposal'),
          ...travelRoutes('itinerary'),
          ...LEGACY_PROPOSAL_REDIRECTS,
          { path: 'dashboard', component: Stub },
          { path: '**', component: Stub }
        ]),
        { provide: TRAVEL_FEATURES, useValue: { itinerariesEnabled } },
        { provide: AuthService, useValue: { ready: async () => undefined, profile: () => ({ role: role ?? undefined }) } }
      ]
    });
    return TestBed.inject(Router);
  }

  it('/viajes/itinerarios/import NO existe: cae en el comodín (nunca en el importador de PDF)', async () => {
    const router = await setup(true);
    await router.navigateByUrl('/viajes/itinerarios/import');
    expect(leaf(router).routeConfig?.path).toBe('**');
    expect(travelRoutes('itinerary').some((r) => String(r.path).includes('import'))).toBe(false);
  });

  it('/viajes/propuestas/import sí existe', async () => {
    const router = await setup(true);
    await router.navigateByUrl('/viajes/propuestas/import');
    expect(leaf(router).routeConfig?.path).toBe('viajes/propuestas/import');
  });

  it('con Itinerarios apagado, sus rutas redirigen a Propuestas (lista y editor)', async () => {
    const router = await setup(false);
    await router.navigateByUrl('/viajes/itinerarios');
    expect(router.url).toBe('/viajes/propuestas');
    await router.navigateByUrl('/viajes/itinerarios/abc/edit?step=journey');
    expect(router.url).toBe('/viajes/propuestas');
  });

  it('con Itinerarios encendido, las rutas del modo resuelven con data.mode = itinerary', async () => {
    const router = await setup(true);
    await router.navigateByUrl('/viajes/itinerarios/abc/edit?step=journey');
    expect(router.url).toBe('/viajes/itinerarios/abc/edit?step=journey');
    expect(leaf(router).data['mode']).toBe('itinerary');
    await router.navigateByUrl('/viajes/propuestas/abc/edit');
    expect(leaf(router).data['mode']).toBe('proposal');
  });

  it('el permiso es del modo: sin rol (sin itinerarios.ver) no se entra a la lista de itinerarios', async () => {
    const router = await setup(true, null);
    await router.navigateByUrl('/viajes/itinerarios');
    expect(router.url).toBe('/dashboard');
  });

  it('las rutas antiguas /proposals/... siguen funcionando y conservan los query params', async () => {
    const router = await setup(true);
    await router.navigateByUrl('/proposals/abc/edit?step=preview&utm=mail');
    expect(router.url).toBe('/viajes/propuestas/abc/edit?step=preview&utm=mail');
    await router.navigateByUrl('/proposals');
    expect(router.url).toBe('/viajes/propuestas');
  });

  it('travelPaths arma cada ruta desde su modo (nadie escribe /proposals a mano)', () => {
    expect(travelPaths.edit('itinerary', 'x')).toEqual(['/viajes/itinerarios', 'x', 'edit']);
    expect(travelPaths.create('itinerary')).toBe('/viajes/itinerarios/new');
    expect(travelPaths.list('proposal')).toBe('/viajes/propuestas');
  });
});
