import { Component, inject } from '@angular/core';
import { Header } from './features/header/header';
import { Hero } from './features/hero/hero';
import { Destinations } from './features/destinations/destinations';
import { TravelProcess } from './features/travel-process/travel-process';
import { Experiences } from './features/experiences/experiences';
import { TheEdit } from './features/the-edit/the-edit';
import { About } from './features/about/about';
import { FinalCta } from './features/final-cta/final-cta';
import { Footer } from './features/footer/footer';
import { CustomCursor } from './features/custom-cursor/custom-cursor';
import { TravelEditForm } from './features/travel-edit-form/travel-edit-form';
import { TravelEditFormService } from './core/services/travel-edit-form';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    Header,
    Hero,
    Destinations,
    TravelProcess,
    Experiences,
    TheEdit,
    About,
    FinalCta,
    Footer,
    CustomCursor,
    TravelEditForm
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  private readonly travelEditForm = inject(TravelEditFormService);
  readonly travelEditFormRequested = this.travelEditForm.isOpen;
}
