import { Component } from '@angular/core';
import { TRAVEL_PROCESS_STEPS } from '../../core/data/travel-process';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';

@Component({
  selector: 'app-travel-process',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './travel-process.html',
  styleUrl: './travel-process.css'
})
export class TravelProcess {
  readonly steps = TRAVEL_PROCESS_STEPS;
}
