import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { DestinationsService } from '../../../core/services/destinations';
import { Destination } from '../../../core/models/destination.model';
import { DestinationStatus } from '../../../core/models/destination-enums';
import { DESTINATION_STATUS_LABEL } from '../../../core/data/destination-options';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-destinations-list',
  imports: [FormsModule, RouterLink, DatePipe],
  templateUrl: './destinations-list.html',
  styleUrl: './destinations-list.css'
})
export class DestinationsList {
  private readonly destinationsService = inject(DestinationsService);
  private readonly router = inject(Router);

  readonly statusLabel = DESTINATION_STATUS_LABEL;
  readonly items = signal<Destination[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly statusFilter = signal<DestinationStatus | ''>('');
  readonly newTitle = signal('');
  readonly creating = signal(false);

  readonly pageSize = PAGE_SIZE;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const result = await this.destinationsService.list({
      page: this.page(),
      pageSize: this.pageSize,
      status: this.statusFilter() || undefined
    });
    this.items.set(result.items);
    this.total.set(result.total);
    this.loading.set(false);
  }

  async setStatusFilter(status: DestinationStatus | ''): Promise<void> {
    this.statusFilter.set(status);
    this.page.set(1);
    await this.load();
  }

  async goToPage(page: number): Promise<void> {
    this.page.set(page);
    await this.load();
  }

  totalPages(): number {
    return Math.max(1, Math.ceil(this.total() / this.pageSize));
  }

  async createDraft(): Promise<void> {
    const title = this.newTitle().trim();
    if (!title || this.creating()) {
      return;
    }

    this.creating.set(true);
    try {
      const destination = await this.destinationsService.createDraft(title);
      await this.router.navigate(['/destinos', destination.id, 'general']);
    } finally {
      this.creating.set(false);
    }
  }
}
