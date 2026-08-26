import { Component, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';
import { Header } from '../header/header';
import { Hero } from '../hero/hero';
import { Destinations } from '../destinations/destinations';
import { TravelProcess } from '../travel-process/travel-process';
import { Experiences } from '../experiences/experiences';
import { TheEdit } from '../the-edit/the-edit';
import { About } from '../about/about';
import { FinalCta } from '../final-cta/final-cta';
import { CustomSections } from '../custom-sections/custom-sections';
import { Footer } from '../footer/footer';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [Header, Hero, Destinations, TravelProcess, Experiences, TheEdit, About, FinalCta, CustomSections, Footer],
  templateUrl: './home.html',
  styleUrl: './home.css'
})
export class Home {
  private readonly title = inject(Title);
  private readonly meta = inject(Meta);

  constructor() {
    this.title.setTitle('The Travel Edit — Because luxury is personal.');
    this.meta.updateTag({
      name: 'description',
      content: 'The Travel Edit diseña viajes de lujo a medida. Menos turismo masivo, más experiencias con sentido.'
    });
  }
}
