import { Component, input } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';

/** «Recomendaciones del día» de la vista previa: espejo del bloque del sitio público (day-recommendations del sitio). */
@Component({
  selector: 'app-preview-day-recommendations',
  templateUrl: './preview-day-recommendations.html',
  styleUrl: './preview-day-recommendations.css'
})
export class PreviewDayRecommendations {
  readonly headline = input.required<string>();
  readonly html = input<SafeHtml | null>(null);
}
