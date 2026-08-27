import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { EXPERIENCES, Experience } from '../../core/data/experiences';
import { ExperienceCard } from './experience-card/experience-card';
import { ExperienceIcon } from './experience-icon/experience-icon';
import { SectionTitle } from '../../shared/ui/section-title/section-title';
import { SiteContentService } from '../../core/services/site-content';

interface ExperiencesHeading {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  support: string;
}

const HEADING_DEFAULT: ExperiencesHeading = {
  eyebrow: 'Experiences',
  headingLine1: 'How do you',
  headingLine2: 'want to feel?',
  support: 'Every journey starts with how you want to experience it.'
};

@Component({
  selector: 'app-experiences',
  standalone: true,
  imports: [ExperienceCard, ExperienceIcon, SectionTitle, RouterLink],
  templateUrl: './experiences.html',
  styleUrl: './experiences.css'
})
export class Experiences {
  private readonly siteContent = inject(SiteContentService);

  readonly heading = signal<ExperiencesHeading>(HEADING_DEFAULT);
  readonly experiences = signal<Experience[]>(EXPERIENCES);
  readonly activeIndex = signal(0);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const data = await this.siteContent.getExperiencias();
    if (!data) {
      return;
    }
    this.heading.update((current) => ({ ...current, ...data }));
    if (data.items && data.items.length > 0) {
      this.experiences.set(data.items);
    }
  }

  setActive(index: number): void {
    this.activeIndex.set(index);
  }
}
