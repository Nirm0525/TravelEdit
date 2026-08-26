import { Component, computed, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AdminPageHeader, BreadcrumbItem } from '../admin-page-header/admin-page-header';
import { AdminSkeleton } from '../admin-skeleton/admin-skeleton';
import { PreviewModal } from '../preview-modal/preview-modal';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-content-editor-layout',
  imports: [RouterLink, AdminPageHeader, AdminSkeleton, PreviewModal],
  templateUrl: './content-editor-layout.html',
  styleUrl: './content-editor-layout.css'
})
export class ContentEditorLayout {
  readonly breadcrumb = input<BreadcrumbItem[] | null>(null);
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly previewHref = input<string | null>(null);
  readonly backLink = input('/contenido');

  readonly previewOpen = signal(false);

  readonly resolvedPreviewHref = computed(() => {
    const href = this.previewHref();
    return href ? `${environment.publicSiteUrl}${href}` : null;
  });

  readonly activePreviewUrl = computed(() => (this.previewOpen() ? this.resolvedPreviewHref() : null));

  readonly loading = input(false);
  readonly saving = input(false);
  readonly saved = input(false);
  readonly errorMessage = input<string | null>(null);
}
