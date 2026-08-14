import { Component, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { MagneticDirective } from '../../directives/magnetic';

@Component({
  selector: 'app-animated-button',
  standalone: true,
  imports: [MagneticDirective, NgTemplateOutlet],
  templateUrl: './animated-button.html',
  styleUrl: './animated-button.css'
})
export class AnimatedButton {
  readonly href = input<string>();
  readonly variant = input<'solid' | 'outline'>('solid');
  readonly theme = input<'light' | 'dark'>('light');
  readonly type = input<'button' | 'submit'>('button');
  readonly disabled = input(false);
  readonly withStar = input(true);

  readonly buttonClick = output<void>();
}
