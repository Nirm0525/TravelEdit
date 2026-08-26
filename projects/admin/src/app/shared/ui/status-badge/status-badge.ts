import { Component, input } from '@angular/core';

export type StatusBadgeVariant = 'neutral' | 'success' | 'warning' | 'danger';

@Component({
  selector: 'app-status-badge',
  templateUrl: './status-badge.html',
  styleUrl: './status-badge.css'
})
export class StatusBadge {
  readonly label = input.required<string>();
  readonly variant = input<StatusBadgeVariant>('neutral');
}
