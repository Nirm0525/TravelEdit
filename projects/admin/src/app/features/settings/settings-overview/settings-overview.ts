import { Component } from '@angular/core';
import { AdminPageHeader, BreadcrumbItem } from '../../../shared/ui/admin-page-header/admin-page-header';
import { ContentSectionCard } from '../../../shared/ui/content-section-card/content-section-card';

interface SettingsCategory {
  key: string;
  name: string;
  description: string;
  editLink: string;
}

const CATEGORIES: SettingsCategory[] = [
  {
    key: 'general',
    name: 'General',
    description: 'Nombre del sitio, empresa, URL pública, idioma y estado.',
    editLink: '/configuracion/general'
  },
  {
    key: 'contacto',
    name: 'Contacto',
    description: 'Email principal, email para solicitudes, teléfono, WhatsApp y horario.',
    editLink: '/configuracion/contacto'
  },
  {
    key: 'correos',
    name: 'Correos',
    description: 'Remitente y administrador usados por Resend para el envío de correos.',
    editLink: '/configuracion/correos'
  },
  {
    key: 'leads',
    name: 'Leads',
    description: 'Notificaciones, confirmación al cliente y estado de los envíos de email.',
    editLink: '/configuracion/leads'
  },
  {
    key: 'seguridad',
    name: 'Seguridad',
    description: 'Estado de Turnstile, Resend y Supabase.',
    editLink: '/configuracion/seguridad'
  },
  {
    key: 'apariencia',
    name: 'Apariencia',
    description: 'Logo, favicon y color de acento de la marca.',
    editLink: '/configuracion/apariencia'
  }
];

@Component({
  selector: 'app-settings-overview',
  imports: [AdminPageHeader, ContentSectionCard],
  templateUrl: './settings-overview.html',
  styleUrl: './settings-overview.css'
})
export class SettingsOverview {
  readonly breadcrumb: BreadcrumbItem[] = [{ label: 'Panel', link: '/dashboard' }, { label: 'Configuración' }];
  readonly categories = CATEGORIES;
}
