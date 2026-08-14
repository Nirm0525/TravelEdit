import { Component, input } from '@angular/core';
import { Experience } from '../../../core/data/experiences';

@Component({
  selector: 'app-experience-icon',
  standalone: true,
  templateUrl: './experience-icon.html'
})
export class ExperienceIcon {
  readonly type = input.required<Experience['icon']>();
}
