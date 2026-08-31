import { Component, computed, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DatePipe } from '@angular/common';
import { environment } from '../../../../environments/environment';

@Component({
  selector: 'app-content-section-card',
  imports: [RouterLink, DatePipe],
  templateUrl: './content-section-card.html',
  styleUrl: './content-section-card.css'
})
export class ContentSectionCard {
  readonly name = input.required<string>();
  readonly description = input.required<string>();
  readonly editLink = input.required<string>();
  readonly previewHref = input<string | null>(null);
  readonly updatedAt = input<string | null>(null);
  readonly loading = input(false);

  readonly resolvedPreviewHref = computed(() => {
    const href = this.previewHref();
    return href ? `${environment.publicSiteUrl}${href}` : null;
  });

  /** El padre (ContentOverview) es quien posee el único <app-preview-modal>
   *  compartido — mismo modal con pestañas Desktop/Tablet/Mobile que ya usan
   *  los editores individuales vía ContentEditorLayout. */
  readonly previewRequested = output<string>();

  requestPreview(url: string, event: MouseEvent): void {
    event.preventDefault();
    this.previewRequested.emit(url);
  }
}
