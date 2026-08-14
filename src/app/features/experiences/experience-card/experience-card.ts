import { Component, input } from '@angular/core';
import { Experience } from '../../../core/data/experiences';
import { ExperienceIcon } from '../experience-icon/experience-icon';

@Component({
  selector: 'app-experience-card',
  standalone: true,
  imports: [ExperienceIcon],
  templateUrl: './experience-card.html',
  styleUrl: './experience-card.css'
})
export class ExperienceCard {
  readonly experience = input.required<Experience>();
}
