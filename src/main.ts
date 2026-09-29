import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Sin esto, DatePipe con formato 'MMMM'/'MMM' (usado en private-proposal.html
// y potencialmente en otras pantallas) cae al locale por defecto de Angular
// (en-US) y muestra meses en inglés — "28 de September de 2026" en vez de
// "28 de septiembre de 2026" — aunque todo el resto de la copy sea español.
// Bug real encontrado en QA de la vista pública de propuestas.
registerLocaleData(localeEs);

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
