import { Component, inject, signal } from '@angular/core';
import { DatePipe, KeyValuePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { LeadsService } from '../../../core/services/leads';
import { Lead } from '../../../core/models/lead.model';
import { LeadOrigin, LeadStatus } from '../../../core/models/lead-enums';
import { LEAD_ORIGIN_LABEL, LEAD_STATUS_LABEL, LEAD_STATUS_OPTIONS } from '../../../core/data/lead-options';
import { downloadCsv, toCsv } from '../../../core/utils/csv';

const PAGE_SIZE = 20;

@Component({
  selector: 'app-leads-list',
  imports: [FormsModule, RouterLink, DatePipe, KeyValuePipe],
  templateUrl: './leads-list.html',
  styleUrl: './leads-list.css'
})
export class LeadsList {
  private readonly leadsService = inject(LeadsService);

  readonly statusLabel = LEAD_STATUS_LABEL;
  readonly originLabel = LEAD_ORIGIN_LABEL;
  readonly statusOptions = LEAD_STATUS_OPTIONS;

  readonly items = signal<Lead[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly exporting = signal(false);

  readonly statusFilter = signal<LeadStatus | ''>('');
  readonly originFilter = signal<LeadOrigin | ''>('');
  readonly destinationSearch = signal('');
  readonly createdFrom = signal('');
  readonly createdTo = signal('');

  readonly pageSize = PAGE_SIZE;

  constructor() {
    void this.load();
  }

  private currentParams() {
    return {
      status: this.statusFilter() || undefined,
      origin: this.originFilter() || undefined,
      destinationSearch: this.destinationSearch() || undefined,
      createdFrom: this.createdFrom() || undefined,
      createdTo: this.createdTo() || undefined
    };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    const result = await this.leadsService.list({
      page: this.page(),
      pageSize: this.pageSize,
      ...this.currentParams()
    });
    this.items.set(result.items);
    this.total.set(result.total);
    this.loading.set(false);
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
          creado: lead.createdAt
        })),
        [
          { key: 'nombre', header: 'Nombre' },
          { key: 'correo', header: 'Correo' },
          { key: 'telefono', header: 'Teléfono' },
          { key: 'destino', header: 'Destino de interés' },
          { key: 'origen', header: 'Origen' },
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
