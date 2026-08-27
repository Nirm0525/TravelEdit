import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth-guard';
import { permissionGuard } from './core/guards/permission-guard';
import { unsavedChangesGuard } from './core/guards/unsaved-changes-guard';

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
        path: 'blog',
        data: { title: 'Blog' },
        canActivate: [permissionGuard('blog')],
        loadComponent: () => import('./features/blog/blog-list/blog-list').then((m) => m.BlogList)
      },
      {
        path: 'blog/nuevo',
        data: { title: 'Nuevo artículo' },
        canActivate: [permissionGuard('blog')],
        loadComponent: () => import('./features/blog/blog-editor/blog-editor').then((m) => m.BlogEditor)
      },
      {
        path: 'blog/:id',
        data: { title: 'Editar artículo' },
        canActivate: [permissionGuard('blog')],
        loadComponent: () => import('./features/blog/blog-editor/blog-editor').then((m) => m.BlogEditor)
      },
      {
        path: 'destinos',
        data: { title: 'Destinos' },
        canActivate: [permissionGuard('destinos')],
        loadComponent: () =>
          import('./features/destinations/destinations-list/destinations-list').then((m) => m.DestinationsList)
      },
      {
        path: 'destinos/nuevo',
        data: { title: 'Nuevo destino' },
        canActivate: [permissionGuard('destinos')],
        loadComponent: () =>
          import('./features/destinations/destination-create/destination-create').then((m) => m.DestinationCreate)
      },
      {
        path: 'destinos/:id',
        data: { title: 'Editar destino' },
        canActivate: [permissionGuard('destinos')],
        loadComponent: () =>
          import('./features/destinations/destination-form/destination-form').then((m) => m.DestinationForm),
        children: [
          { path: '', redirectTo: 'general', pathMatch: 'full' },
          {
            path: 'general',
            canDeactivate: [unsavedChangesGuard],
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
        canActivate: [permissionGuard('solicitudes')],
        loadComponent: () => import('./features/leads/leads-list/leads-list').then((m) => m.LeadsList)
      },
      {
        path: 'solicitudes/:id',
        data: { title: 'Detalle de solicitud' },
        canActivate: [permissionGuard('solicitudes')],
        loadComponent: () => import('./features/leads/lead-detail/lead-detail').then((m) => m.LeadDetail)
      },
      {
        path: 'contenido',
        data: { title: 'Página principal' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () =>
          import('./features/content/content-overview/content-overview').then((m) => m.ContentOverview)
      },
      {
        path: 'contenido/hero',
        data: { title: 'Hero' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () => import('./features/content/hero-editor/hero-editor').then((m) => m.HeroEditor)
      },
      {
        path: 'contenido/destinos-destacados',
        data: { title: 'Destinos destacados' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () =>
          import('./features/content/destinos-destacados-editor/destinos-destacados-editor').then(
            (m) => m.DestinosDestacadosEditor
          )
      },
      {
        path: 'contenido/travel-process',
        data: { title: 'Travel Process' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () =>
          import('./features/content/travel-process-editor/travel-process-editor').then(
            (m) => m.TravelProcessEditor
          )
      },
      {
        path: 'contenido/experiencias',
        data: { title: 'Experiencias' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () =>
          import('./features/content/experiencias-editor/experiencias-editor').then((m) => m.ExperienciasEditor)
      },
      {
        path: 'contenido/the-edit',
        data: { title: 'The Edit' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () => import('./features/content/the-edit-editor/the-edit-editor').then((m) => m.TheEditEditor)
      },
      {
        path: 'contenido/about',
        data: { title: 'About' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () => import('./features/content/about-editor/about-editor').then((m) => m.AboutEditor)
      },
      {
        path: 'contenido/cta-final',
        data: { title: 'CTA final' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () => import('./features/content/cta-final-editor/cta-final-editor').then((m) => m.CtaFinalEditor)
      },
      {
        path: 'contenido/footer',
        data: { title: 'Footer' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () => import('./features/content/footer-editor/footer-editor').then((m) => m.FooterEditor)
      },
      {
        path: 'contenido/personalizada/:id',
        data: { title: 'Sección personalizada' },
        canActivate: [permissionGuard('contenido')],
        loadComponent: () =>
          import('./features/content/custom-section-editor/custom-section-editor').then((m) => m.CustomSectionEditor)
      },
      {
        path: 'usuarios',
        data: { title: 'Usuarios' },
        canActivate: [permissionGuard('usuarios')],
        loadComponent: () => import('./features/users/users-list/users-list').then((m) => m.UsersList)
      },
      {
        path: 'usuarios/:id',
        data: { title: 'Detalle de usuario' },
        canActivate: [permissionGuard('usuarios')],
        loadComponent: () => import('./features/users/user-detail/user-detail').then((m) => m.UserDetail)
      },
      {
        path: 'configuracion',
        data: { title: 'Configuración' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/settings-overview/settings-overview').then((m) => m.SettingsOverview)
      },
      {
        path: 'configuracion/general',
        data: { title: 'General' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/general-settings/general-settings').then((m) => m.GeneralSettings)
      },
      {
        path: 'configuracion/contacto',
        data: { title: 'Contacto' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/contact-settings/contact-settings').then((m) => m.ContactSettings)
      },
      {
        path: 'configuracion/correos',
        data: { title: 'Correos' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/email-settings/email-settings').then((m) => m.EmailSettings)
      },
      {
        path: 'configuracion/leads',
        data: { title: 'Configuración de leads' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/leads-settings/leads-settings').then((m) => m.LeadsSettings)
      },
      {
        path: 'configuracion/seguridad',
        data: { title: 'Seguridad' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () => import('./features/settings/security-settings/security-settings').then((m) => m.SecuritySettings)
      },
      {
        path: 'configuracion/apariencia',
        data: { title: 'Apariencia' },
        canActivate: [permissionGuard('configuracion')],
        loadComponent: () =>
          import('./features/settings/appearance-settings/appearance-settings').then((m) => m.AppearanceSettings)
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
