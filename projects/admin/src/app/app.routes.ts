import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login)
  },
  {
    path: '',
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        data: { title: 'Dashboard' },
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard)
      },
      {
        path: 'destinos',
        data: { title: 'Destinos' },
        loadComponent: () =>
          import('./features/destinations/destinations-list/destinations-list').then((m) => m.DestinationsList)
      },
      {
        path: 'destinos/:id',
        data: { title: 'Editar destino' },
        loadComponent: () =>
          import('./features/destinations/destination-form/destination-form').then((m) => m.DestinationForm),
        children: [
          { path: '', redirectTo: 'general', pathMatch: 'full' },
          {
            path: 'general',
            loadComponent: () =>
              import('./features/destinations/destination-form/general/general').then((m) => m.General)
          },
          {
            path: 'itinerario',
            loadComponent: () =>
              import('./features/destinations/destination-form/itinerary/itinerary').then((m) => m.Itinerary)
          },
          {
            path: 'galeria',
            loadComponent: () =>
              import('./features/destinations/destination-form/gallery/gallery').then((m) => m.Gallery)
          },
          {
            path: 'vista-previa',
            loadComponent: () =>
              import('./features/destinations/destination-form/preview/preview').then((m) => m.Preview)
          }
        ]
      },
      {
        path: 'solicitudes',
        data: { title: 'Solicitudes' },
        loadComponent: () => import('./features/leads/leads-list/leads-list').then((m) => m.LeadsList)
      },
      {
        path: 'solicitudes/:id',
        data: { title: 'Detalle de solicitud' },
        loadComponent: () => import('./features/leads/lead-detail/lead-detail').then((m) => m.LeadDetail)
      },
      {
        path: 'contenido/hero',
        data: { title: 'Página principal' },
        loadComponent: () => import('./features/content/hero-editor/hero-editor').then((m) => m.HeroEditor)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
