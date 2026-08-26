import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { DestinationsService } from '../../../core/services/destinations';
import { DestinationImagesService } from '../../../core/services/destination-images';
import { Destination } from '../../../core/models/destination.model';
import { DestinationStatus, TripType } from '../../../core/models/destination-enums';
import { DESTINATION_STATUS_LABEL, TRIP_TYPE_OPTIONS } from '../../../core/data/destination-options';
import { AdminPageHeader, BreadcrumbItem } from '../../../shared/ui/admin-page-header/admin-page-header';
import { AdminTable } from '../../../shared/ui/admin-table/admin-table';
import { StatusBadge, StatusBadgeVariant } from '../../../shared/ui/status-badge/status-badge';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

const STATUS_VARIANT: Record<DestinationStatus, StatusBadgeVariant> = {
  draft: 'neutral',
  published: 'success',
  archived: 'warning'
};

@Component({
  selector: 'app-destinations-list',
  imports: [RouterLink, DatePipe, AdminPageHeader, AdminTable, StatusBadge],
  templateUrl: './destinations-list.html',
  styleUrl: './destinations-list.css'
})
export class DestinationsList {
  private readonly destinationsService = inject(DestinationsService);
  private readonly imagesService = inject(DestinationImagesService);

  readonly breadcrumb: BreadcrumbItem[] = [{ label: 'Panel', link: '/dashboard' }, { label: 'Destinos' }];
  readonly statusLabel = DESTINATION_STATUS_LABEL;
  readonly statusVariant = STATUS_VARIANT;
  readonly tripTypeOptions = TRIP_TYPE_OPTIONS;

  readonly items = signal<Destination[]>([]);
  readonly coverUrlById = signal<Record<string, string>>({});
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly statusFilter = signal<DestinationStatus | ''>('');
  readonly tripTypeFilter = signal<TripType | ''>('');
  readonly search = signal('');

  readonly pageSize = PAGE_SIZE;
  private searchDebounce?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const result = await this.destinationsService.list({
      page: this.page(),
      pageSize: this.pageSize,
      status: this.statusFilter() || undefined,
      tripType: this.tripTypeFilter() || undefined,
      search: this.search().trim() || undefined
    });
    this.items.set(result.items);
    this.total.set(result.total);
    await this.loadCovers(result.items);
    this.loading.set(false);
  }

  private async loadCovers(items: Destination[]): Promise<void> {
    const coverIds = items.map((d) => d.coverImageId).filter((id): id is string => !!id);
    if (coverIds.length === 0) {
      this.coverUrlById.set({});
      return;
    }

    const images = await this.imagesService.listByIds(coverIds);
    const map: Record<string, string> = {};
    for (const item of items) {
      const image = item.coverImageId ? images.find((img) => img.id === item.coverImageId) : undefined;
      if (image) {
        map[item.id] = this.imagesService.publicUrl(image.storagePath);
      }
    }
    this.coverUrlById.set(map);
  }

  async setStatusFilter(status: DestinationStatus | ''): Promise<void> {
    this.statusFilter.set(status);
    this.page.set(1);
    await this.load();
  }

  async setTripTypeFilter(event: Event): Promise<void> {
    this.tripTypeFilter.set((event.target as HTMLSelectElement).value as TripType | '');
    this.page.set(1);
    await this.load();
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  hasActiveFilters(): boolean {
    return !!this.statusFilter() || !!this.tripTypeFilter() || !!this.search().trim();
  }

  async clearFilters(): Promise<void> {
    this.statusFilter.set('');
    this.tripTypeFilter.set('');
    this.search.set('');
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

  statusActionLabel(item: Destination): string {
    return item.status === 'published' ? 'Archivar' : 'Publicar';
  }

  async toggleStatus(item: Destination): Promise<void> {
    const next: DestinationStatus = item.status === 'published' ? 'archived' : 'published';
    await this.destinationsService.updateStatus(item.id, next);
    await this.load();
  }
}
