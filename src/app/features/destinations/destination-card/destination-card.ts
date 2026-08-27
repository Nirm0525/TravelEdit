import { Component, input } from '@angular/core';
import { Destination } from '../../../core/data/destinations';

@Component({
  selector: 'app-destination-card',
  standalone: true,
  templateUrl: './destination-card.html',
  styleUrl: './destination-card.css'
})
export class DestinationCard {
  readonly destination = input.required<Destination>();
  // Solo para escalonar el delay de la animación ambiente (ver .css) — que
  // no todas las tarjetas "respiren" sincronizadas al mismo tiempo.
  readonly index = input(0);
}
