import { inject } from '@angular/core';
import { Route, Router } from '@angular/router';
import { travelGuard } from '../../core/guards/travel-guard';
import { TravelMode, travelConfigOf } from './travel-config';

/**
 * Rutas de un modo de «Viajes»: las MISMAS pantallas (lista, crear, importar, builder) con `data.mode` distinto. Una sola
 * definición, para no duplicar nada. Los hijos van bajo el shell autenticado.
 */
export function travelRoutes(mode: TravelMode): Route[] {
  const config = travelConfigOf(mode);
  const base = config.routeBase.replace(/^\//, '');
  const guard = (code: typeof config.permissions.view) => [travelGuard(mode, code)];
  const labels = config.labels;

  const routes: Route[] = [
    {
      path: base,
      data: { title: labels.plural, mode },
      canActivate: guard(config.permissions.view),
      loadComponent: () => import('../proposals/proposals-list/proposals-list').then((m) => m.ProposalsList)
    },
    {
      path: `${base}/new`,
      data: { title: labels.createTitle, mode },
      canActivate: guard(config.permissions.create),
      loadComponent: () => import('../proposals/proposal-create/proposal-create').then((m) => m.ProposalCreate)
    },
    {
      // Sin unsavedChangesGuard: cada paso autoguarda por campo/acción, mismo criterio que itinerario/galería de Destinos
      // (no el de General, que sí usa guard porque ahí se guarda con botón explícito).
      path: `${base}/:id/edit`,
      data: { title: labels.edit, mode },
      canActivate: guard(config.permissions.edit),
      loadComponent: () => import('../proposals/proposal-builder/proposal-builder').then((m) => m.ProposalBuilder)
    }
  ];

  if (config.capabilities.pdfImport) {
    routes.splice(2, 0, {
      path: `${base}/import`,
      data: { title: labels.importButton, mode },
      canActivate: guard(config.permissions.create),
      loadComponent: () => import('../proposals/proposal-import/proposal-import').then((m) => m.ProposalImport)
    });
  }
  return routes;
}

/**
 * Rutas ANTIGUAS (/proposals/…): redirigen a las nuevas y se conservan PARA SIEMPRE. Los correos ya enviados
 * (notify-proposal-activity), los favoritos y los enlaces guardados las siguen usando. Los query params (p. ej. `?step=preview`) se
 * conservan: en la función se pasan a mano, porque un redirect por función los descarta.
 */
/** Redirección que conserva query params y fragmento (las absolutas y las de función los descartan por defecto). */
const keepingQuery = (target: (params: Record<string, string>) => string[]): Route['redirectTo'] =>
  ({ params, queryParams, fragment }) =>
    inject(Router).createUrlTree(target(params), { queryParams, fragment: fragment ?? undefined });

export const LEGACY_PROPOSAL_REDIRECTS: Route[] = [
  { path: 'proposals', pathMatch: 'full', redirectTo: keepingQuery(() => ['/viajes/propuestas']) },
  { path: 'proposals/new', pathMatch: 'full', redirectTo: keepingQuery(() => ['/viajes/propuestas/new']) },
  { path: 'proposals/import', pathMatch: 'full', redirectTo: keepingQuery(() => ['/viajes/propuestas/import']) },
  { path: 'proposals/:id/edit', pathMatch: 'full', redirectTo: keepingQuery((params) => ['/viajes/propuestas', params['id']!, 'edit']) }
];
