import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./features/home/home').then((m) => m.Home) },
  {
    path: 'disenar-tu-viaje',
    loadComponent: () => import('./features/design-your-trip/design-your-trip').then((m) => m.DesignYourTrip)
  },
  {
    path: 'the-edit/:slug',
    loadComponent: () => import('./features/article-detail/article-detail').then((m) => m.ArticleDetail)
  },
  {
    path: 'private/:token',
    loadComponent: () => import('./features/private-proposal/private-proposal').then((m) => m.PrivateProposal)
  },
  { path: '**', redirectTo: '' }
];
