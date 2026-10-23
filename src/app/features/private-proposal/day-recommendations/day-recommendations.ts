import { Component, input } from '@angular/core';
import type { SafeHtml } from '@angular/platform-browser';

/** Bloque «Recomendaciones del día» del viajero. Recibe el HTML ya saneado (sanitizeRichHtml) desde private-proposal. */
@Component({
  selector: 'app-day-recommendations',
  templateUrl: './day-recommendations.html',
  styleUrl: './day-recommendations.css'
})
export class DayRecommendations {
  readonly headline = input.required<string>();
  readonly html = input<SafeHtml | null>(null);
}
