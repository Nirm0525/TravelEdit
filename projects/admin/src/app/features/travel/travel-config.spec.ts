import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { ITINERARIES_ENABLED, TRAVEL_CONFIG, TRAVEL_FEATURES, isTravelModeEnabled, travelPaths } from './travel-config';
import { LEGACY_PROPOSAL_REDIRECTS, travelRoutes } from './travel-routes';
import { ROLE_PERMISSION_CODES, can } from '../../core/data/permissions';

describe('Viajes — configuración por modo', () => {
  it('Itinerarios está ACTIVO (ITINERARIES_ENABLED) y se ofrece por defecto; Propuestas siempre activo', () => {
    expect(ITINERARIES_ENABLED).toBe(true);
    expect(TestBed.inject(TRAVEL_FEATURES).itinerariesEnabled).toBe(true);
    expect(isTravelModeEnabled('proposal', TestBed.inject(TRAVEL_FEATURES))).toBe(true);
    expect(isTravelModeEnabled('itinerary', TestBed.inject(TRAVEL_FEATURES))).toBe(true);
    // El mecanismo del flag sigue funcionando (apagar el modo lo oculta).
    expect(isTravelModeEnabled('proposal', { itinerariesEnabled: false })).toBe(true);
    expect(isTravelModeEnabled('itinerary', { itinerariesEnabled: false })).toBe(false);
    expect(isTravelModeEnabled('itinerary', { itinerariesEnabled: true })).toBe(true);
  });

  it('Propuestas conserva todas sus capacidades y pestañas', () => {
    const c = TRAVEL_CONFIG.proposal;
    // shareAccess es de Itinerario; en Propuesta la publicación comercial lo reemplaza.
    const { shareAccess, ...rest } = c.capabilities;
    expect(shareAccess).toBe(false);
    expect(Object.values(rest).every(Boolean)).toBe(true);
    expect(c.tabs.map((t) => t.key)).toEqual(['client-trip', 'cover', 'journey', 'pricing', 'travel-tips', 'terms', 'assistant']);
  });

  it('Itinerarios es privado (código, expiración, documentos) pero sin nada comercial', () => {
    const c = TRAVEL_CONFIG.itinerary.capabilities;
    expect([c.privateAccess, c.accessCode, c.expiration, c.documents, c.aiAssistant, c.preview, c.clientEmail, c.shareAccess]).toEqual(Array(8).fill(true));
    expect([c.pricing, c.terms, c.accept, c.serviceChoices, c.quoteComments, c.pdfImport, c.publish, c.previewPanel]).toEqual(Array(8).fill(false));
    expect(TRAVEL_CONFIG.itinerary.tabs.map((t) => t.label)).toEqual(['Datos del viaje', 'Portada', 'Itinerario', 'Travel Tips', 'The Edit Assistant']);
  });

  it('Itinerarios no tiene precios, términos, publicación ni importación', () => {
    const c = TRAVEL_CONFIG.itinerary;
    expect(c.capabilities.publish || c.capabilities.pricing || c.capabilities.terms || c.capabilities.pdfImport).toBe(false);
    expect(c.tabs.map((t) => t.key)).not.toContain('pricing');
    expect(c.tabs.map((t) => t.key)).not.toContain('terms');
  });

  it('las rutas salen de una sola función: Itinerarios no tiene /import', () => {
    expect(travelRoutes('proposal').map((r) => r.path)).toContain('viajes/propuestas/import');
    expect(travelRoutes('itinerary').map((r) => r.path)).not.toContain('viajes/itinerarios/import');
    expect(travelPaths.edit('proposal', 'x')).toEqual(['/viajes/propuestas', 'x', 'edit']);
  });

  it('todos los códigos de permiso que usa la configuración existen para cada rol', () => {
    for (const cfg of Object.values(TRAVEL_CONFIG)) {
      for (const code of Object.values(cfg.permissions)) {
        for (const role of Object.keys(ROLE_PERMISSION_CODES) as (keyof typeof ROLE_PERMISSION_CODES)[]) {
          // Eliminar es solo de admin (como la RLS); todo lo demás lo tienen los tres roles.
          expect(can(role, code), `${role} ${code}`).toBe(role === 'admin' || !code.endsWith('.eliminar'));
        }
      }
      for (const tab of cfg.tabs) {
        if (tab.permission) expect(can('staff', tab.permission)).toBe(true);
      }
    }
    for (const code of ['propuestas.eliminar', 'itinerarios.eliminar'] as const) {
      expect(can('admin', code)).toBe(true);
      expect(can('editor', code)).toBe(false);
      expect(can('staff', code)).toBe(false);
    }
    expect(can(undefined, 'viajes.ver')).toBe(false);
    expect(can('staff', 'viajes.ver')).toBe(true);
  });
});

describe('Viajes — redirecciones antiguas', () => {
  let router: Router;
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter([...LEGACY_PROPOSAL_REDIRECTS, { path: 'viajes/propuestas', children: [{ path: '**', children: [] }] }])]
    });
    router = TestBed.inject(Router);
  });

  it.each([
    ['/proposals', '/viajes/propuestas'],
    ['/proposals/new', '/viajes/propuestas/new'],
    ['/proposals/import', '/viajes/propuestas/import'],
    ['/proposals/abc-1/edit', '/viajes/propuestas/abc-1/edit'],
    ['/proposals/abc-1/edit?step=preview', '/viajes/propuestas/abc-1/edit?step=preview']
  ])('%s → %s (conserva query params)', async (from, to) => {
    await router.navigateByUrl(from);
    expect(router.url).toBe(to);
  });

  it('también conserva query params en las redirecciones estáticas', async () => {
    await router.navigateByUrl('/proposals?x=1');
    expect(router.url).toBe('/viajes/propuestas?x=1');
  });
});
