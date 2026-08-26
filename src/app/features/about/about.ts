import { Component, inject, signal } from '@angular/core';
import { IMAGES } from '../../core/data/images';
import { RevealOnScrollDirective } from '../../shared/directives/reveal-on-scroll';
import { SiteContentService } from '../../core/services/site-content';

interface AboutContent {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  paragraph1: string;
  paragraph2: string;
  paragraph3: string;
  words: string[];
  imageUrl: string;
  imageAlt: string;
}

const ABOUT_DEFAULT: AboutContent = {
  eyebrow: 'Our Story',
  titleLine1: 'Travel should',
  titleLine2: 'feel personal.',
  paragraph1:
    'The Travel Edit nació de una forma diferente de entender los viajes: creemos que el lujo no está en hacer más, sino en elegir mejor.',
  paragraph2:
    'En conocer lugares extraordinarios, vivir experiencias auténticas y tener el tiempo para realmente disfrutarlas.',
  paragraph3:
    'Por eso, cada viaje comienza contigo. Con lo que te inspira, lo que disfrutas y la forma en que quieres descubrir el mundo.',
  words: ['Intentional.', 'Personal.', 'Curated.', 'Meaningful.'],
  imageUrl: IMAGES.about.url,
  imageAlt: IMAGES.about.alt
};

@Component({
  selector: 'app-about',
  standalone: true,
  imports: [RevealOnScrollDirective],
  templateUrl: './about.html',
  styleUrl: './about.css'
})
export class About {
  private readonly siteContent = inject(SiteContentService);

  readonly content = signal<AboutContent>(ABOUT_DEFAULT);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getAbout();
    if (data) {
      this.content.update((current) => ({ ...current, ...data }));
    }
  }
}
