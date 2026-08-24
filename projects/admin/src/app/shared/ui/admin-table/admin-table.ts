import { Component, input } from '@angular/core';
import { AdminSkeleton } from '../admin-skeleton/admin-skeleton';
import { AdminEmptyState } from '../admin-empty-state/admin-empty-state';

@Component({
  selector: 'app-admin-table',
  imports: [AdminSkeleton, AdminEmptyState],
  templateUrl: './admin-table.html',
  styleUrl: './admin-table.css'
})
export class AdminTable {
  readonly loading = input(false);
  readonly empty = input(false);
  readonly emptyMessage = input('No hay datos todavía.');
  readonly skeletonRows = [1, 2, 3, 4, 5];
}
