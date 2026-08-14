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
}
