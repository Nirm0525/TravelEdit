import { Component, input } from '@angular/core';

@Component({
  selector: 'app-admin-empty-state',
  templateUrl: './admin-empty-state.html',
  styleUrl: './admin-empty-state.css'
})
export class AdminEmptyState {
  readonly title = input<string | null>(null);
  readonly message = input.required<string>();
}
