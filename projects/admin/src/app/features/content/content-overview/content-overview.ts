import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { SiteContentService } from '../../../core/services/site-content';
import { CustomSection } from '../../../core/models/site-content.model';
import { AdminPageHeader, BreadcrumbItem } from '../../../shared/ui/admin-page-header/admin-page-header';
import { ContentSectionCard } from '../../../shared/ui/content-section-card/content-section-card';
import { PreviewModal } from '../../../shared/ui/preview-modal/preview-modal';
import { environment } from '../../../../environments/environment';

interface SectionSummary {
  sectionKey: string;
  name: string;
  description: string;
  editLink: string;
  previewHref: string | null;
}

const SECTIONS: SectionSummary[] = [
  {
    sectionKey: 'hero',
    name: 'Hero',
    description: 'Imagen, título y CTA principal de la portada.',
    editLink: '/contenido/hero',
    previewHref: '/'
  },
  {
    sectionKey: 'destinos_destacados',
    name: 'Destinos destacados',
    description: 'Selección y orden de los destinos mostrados en Home.',
    editLink: '/contenido/destinos-destacados',
    previewHref: '/#destinos'
  },
  {
    sectionKey: 'travel_process',
    name: 'Travel Process',
    description: 'Los pasos del proceso de planificación de viaje.',
    editLink: '/contenido/travel-process',
    previewHref: null
  },
  {
    sectionKey: 'experiencias',
    name: 'Experiencias',
    description: 'Tipos de experiencia mostrados en Home.',
    editLink: '/contenido/experiencias',
    previewHref: '/#experiencias'
  },
  {
    sectionKey: 'the_edit',
    name: 'The Edit',
    description: 'Artículos y notas editoriales destacadas.',
    editLink: '/contenido/the-edit',
    previewHref: '/#the-edit'
  },
  {
    sectionKey: 'about',
    name: 'About',
    description: 'Historia y presentación de la marca.',
    editLink: '/contenido/about',
    previewHref: '/#about'
  },
  {
    sectionKey: 'cta_final',
    name: 'CTA final',
    description: 'Llamado a la acción antes del footer.',
    editLink: '/contenido/cta-final',
    previewHref: null
  },
  {
    sectionKey: 'footer',
    name: 'Footer',
    description: 'Enlaces, redes sociales y datos de contacto.',
    editLink: '/contenido/footer',
    previewHref: null
  }
];

@Component({
  selector: 'app-content-overview',
  imports: [AdminPageHeader, ContentSectionCard, PreviewModal],
  templateUrl: './content-overview.html',
  styleUrl: './content-overview.css'
})
export class ContentOverview {
  private readonly siteContent = inject(SiteContentService);
  private readonly router = inject(Router);

  readonly breadcrumb: BreadcrumbItem[] = [{ label: 'Panel', link: '/dashboard' }, { label: 'Página principal' }];
  readonly homePreviewHref = `${environment.publicSiteUrl}/`;

  // Mismo modal con pestañas Desktop/Tablet/Mobile que ya usan los editores
  // individuales (vía ContentEditorLayout) — un solo modal compartido para
  // el botón de arriba y el de cada tarjeta, en vez de abrir una pestaña
  // nueva por separado.
  readonly previewUrl = signal<string | null>(null);

  openPreview(url: string): void {
    this.previewUrl.set(url);
  }

  closePreview(): void {
    this.previewUrl.set(null);
  }

  readonly sections = SECTIONS;
  readonly customSections = signal<CustomSection[]>([]);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly error = signal<string | null>(null);
  readonly updatedAtBySection = signal<Record<string, string>>({});

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [meta, customContent] = await Promise.all([
        this.siteContent.listMeta(),
        this.siteContent.getCustomSections()
      ]);
      this.updatedAtBySection.set(
        meta.reduce<Record<string, string>>((acc, row) => {
          acc[row.sectionKey] = row.updatedAt;
          return acc;
        }, {})
      );
      this.customSections.set(customContent.sections);
    } catch (err) {
      console.error('No se pudo cargar la página principal.', err);
      this.error.set('No pudimos cargar las secciones. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  async createSection(): Promise<void> {
    if (this.creating()) {
      return;
    }
    this.creating.set(true);
    try {
      const content = await this.siteContent.getCustomSections();
      const section: CustomSection = {
        id: crypto.randomUUID(),
        eyebrow: '',
        title: '',
        body: '',
        imageUrl: '',
        imageAlt: ''
      };
      await this.siteContent.updateCustomSections({ sections: [...content.sections, section] });
      await this.router.navigate(['/contenido/personalizada', section.id]);
    } finally {
      this.creating.set(false);
    }
  }
}
