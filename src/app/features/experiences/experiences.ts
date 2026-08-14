import { Component, signal } from '@angular/core';
import { EXPERIENCES } from '../../core/data/experiences';
import { ExperienceCard } from './experience-card/experience-card';
import { ExperienceIcon } from './experience-icon/experience-icon';
import { SectionTitle } from '../../shared/ui/section-title/section-title';

@Component({
  selector: 'app-experiences',
  standalone: true,
  imports: [ExperienceCard, ExperienceIcon, SectionTitle],
  templateUrl: './experiences.html',
  styleUrl: './experiences.css'
})
export class Experiences {
  readonly experiences = EXPERIENCES;
  readonly activeIndex = signal(0);

  setActive(index: number): void {
    this.activeIndex.set(index);
  }
}
