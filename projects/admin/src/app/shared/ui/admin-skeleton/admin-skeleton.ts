import { Component, input } from '@angular/core';

@Component({
  selector: 'app-admin-skeleton',
  templateUrl: './admin-skeleton.html',
  styleUrl: './admin-skeleton.css'
})
export class AdminSkeleton {
  readonly height = input('1rem');
  readonly width = input('100%');
}
