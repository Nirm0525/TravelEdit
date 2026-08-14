import { Component } from '@angular/core';
import { Header } from './features/header/header';
import { Hero } from './features/hero/hero';
import { Destinations } from './features/destinations/destinations';
import { TravelProcess } from './features/travel-process/travel-process';
import { Experiences } from './features/experiences/experiences';
import { TheEdit } from './features/the-edit/the-edit';
import { Testimonials } from './features/testimonials/testimonials';
import { About } from './features/about/about';
import { FinalCta } from './features/final-cta/final-cta';
import { Footer } from './features/footer/footer';
import { CustomCursor } from './features/custom-cursor/custom-cursor';

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
    Testimonials,
    About,
    FinalCta,
    Footer,
    CustomCursor
  ],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {}
