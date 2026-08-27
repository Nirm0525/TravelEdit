import { Component, inject, signal } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LeadsService, LeadStats } from '../../../core/services/leads';
import { Lead } from '../../../core/models/lead.model';
import { LeadEmailStatus, LeadOrigin, LeadStatus } from '../../../core/models/lead-enums';
import {
  LEAD_EMAIL_STATUS_LABEL,
  LEAD_EMAIL_STATUS_OPTIONS,
  LEAD_ORIGIN_LABEL,
  LEAD_STATUS_LABEL,
  LEAD_STATUS_OPTIONS
} from '../../../core/data/lead-options';
import { downloadCsv, toCsv } from '../../../core/utils/csv';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-leads-list',
  imports: [FormsModule, RouterLink, DatePipe, KeyValuePipe],
  templateUrl: './leads-list.html',
  styleUrl: './leads-list.css'
})
export class LeadsList {
  private readonly leadsService = inject(LeadsService);
  private searchDebounce?: ReturnType<typeof setTimeout>;

  readonly statusLabel = LEAD_STATUS_LABEL;
  readonly originLabel = LEAD_ORIGIN_LABEL;
  readonly statusOptions = LEAD_STATUS_OPTIONS;
  readonly emailStatusLabel = LEAD_EMAIL_STATUS_LABEL;
  readonly emailStatusOptions = LEAD_EMAIL_STATUS_OPTIONS;

  readonly items = signal<Lead[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly exporting = signal(false);

  readonly stats = signal<LeadStats | null>(null);
  readonly statsLoading = signal(true);

  readonly statusFilter = signal<LeadStatus | ''>('');
  readonly originFilter = signal<LeadOrigin | ''>('');
  readonly emailStatusFilter = signal<LeadEmailStatus | ''>('');
  readonly search = signal('');
  readonly createdFrom = signal('');
  readonly createdTo = signal('');

  readonly pageSize = PAGE_SIZE;

  constructor() {
    void this.load();
    void this.loadStats();
  }

  private currentParams() {
    return {
      status: this.statusFilter() || undefined,
      origin: this.originFilter() || undefined,
      emailStatus: this.emailStatusFilter() || undefined,
      search: this.search() || undefined,
      createdFrom: this.createdFrom() || undefined,
      createdTo: this.createdTo() || undefined
    };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const result = await this.leadsService.list({
        page: this.page(),
        pageSize: this.pageSize,
        ...this.currentParams()
      });
      this.items.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      console.error('No se pudieron cargar las solicitudes.', error);
      this.loadError.set('No pudimos cargar las solicitudes. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  private async loadStats(): Promise<void> {
    this.statsLoading.set(true);
    try {
      this.stats.set(await this.leadsService.getStats());
    } catch (error) {
      console.error('No se pudieron cargar las estadísticas de solicitudes.', error);
      this.stats.set(null);
    } finally {
      this.statsLoading.set(false);
    }
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
    clearTimeout(this.searchDebounce);
    this.searchDebounce = setTimeout(() => {
      this.page.set(1);
      void this.load();
    }, SEARCH_DEBOUNCE_MS);
  }

  travelersLabel(lead: Lead): string {
    const parts: string[] = [];
    if (lead.details.adults != null) {
      parts.push(`${lead.details.adults} ad.`);
    }
    if (lead.details.children != null && lead.details.children > 0) {
      parts.push(`${lead.details.children} niños`);
    }
    return parts.length > 0 ? parts.join(', ') : '—';
  }

  rangeStart(): number {
    return this.total() === 0 ? 0 : (this.page() - 1) * this.pageSize + 1;
  }

  rangeEnd(): number {
    return Math.min(this.page() * this.pageSize, this.total());
  }

  async applyFilters(): Promise<void> {
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

  hasActiveFilters(): boolean {
    return (
      !!this.statusFilter() ||
      !!this.originFilter() ||
      !!this.emailStatusFilter() ||
      !!this.search() ||
      !!this.createdFrom() ||
      !!this.createdTo()
    );
  }

  isStale(lead: Lead): boolean {
    if (lead.status !== 'nueva') {
      return false;
    }
    const ageMs = Date.now() - new Date(lead.createdAt).getTime();
    return ageMs > 48 * 60 * 60 * 1000;
  }

  async exportCsv(): Promise<void> {
    if (this.exporting()) {
      return;
    }
    this.exporting.set(true);
    try {
      const leads = await this.leadsService.listForExport(this.currentParams());
      const csv = toCsv(
        leads.map((lead) => ({
          nombre: lead.name,
          correo: lead.email,
          telefono: lead.phone ?? '',
          destino: lead.destinationInterestText ?? '',
          origen: this.originLabel[lead.origin],
          estado: this.statusLabel[lead.status],
          estadoEmail: this.emailStatusLabel[lead.emailStatus],
          creado: lead.createdAt
        })),
        [
          { key: 'nombre', header: 'Nombre' },
          { key: 'correo', header: 'Correo' },
          { key: 'telefono', header: 'Teléfono' },
          { key: 'destino', header: 'Destino de interés' },
          { key: 'origen', header: 'Origen' },
          { key: 'estadoEmail', header: 'Estado del email' },
          { key: 'estado', header: 'Estado' },
          { key: 'creado', header: 'Creado' }
        ]
      );
      downloadCsv(`solicitudes-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    } finally {
      this.exporting.set(false);
    }
  }
}
