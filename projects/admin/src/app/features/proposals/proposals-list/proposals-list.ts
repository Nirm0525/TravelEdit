import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProposalsService } from '../../../core/services/proposals';
import { ProposalImagesService } from '../../../core/services/proposal-images';
import { Proposal } from '../../../core/models/proposal.model';
import { ProposalStatus } from '../../../core/models/proposal-enums';
import { PROPOSAL_STATUS_LABEL } from '../../../core/models/proposal-enums';
import { PROPOSAL_STATUS_OPTIONS } from '../../../core/data/proposal-options';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

@Component({
  selector: 'app-proposals-list',
  imports: [RouterLink, DatePipe, ConfirmDialog],
  templateUrl: './proposals-list.html',
  styleUrl: './proposals-list.css'
})
export class ProposalsList {
  private readonly proposalsService = inject(ProposalsService);
  private readonly proposalImages = inject(ProposalImagesService);

  readonly statusLabel = PROPOSAL_STATUS_LABEL;
  readonly statusOptions = PROPOSAL_STATUS_OPTIONS;

  readonly items = signal<Proposal[]>([]);
  readonly total = signal(0);
  readonly page = signal(1);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly statusFilter = signal<ProposalStatus | ''>('');
  readonly search = signal('');

  readonly counts = signal<Record<ProposalStatus, number>>({
    draft: 0,
    published: 0,
    viewed: 0,
    accepted: 0,
    expired: 0
  });
  readonly totalCount = computed(() => Object.values(this.counts()).reduce((sum, n) => sum + n, 0));

  readonly actionError = signal<string | null>(null);
  readonly togglingId = signal<string | null>(null);
  readonly proposalPendingDelete = signal<Proposal | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly openMenuId = signal<string | null>(null);

  readonly pageSize = PAGE_SIZE;
  private searchDebounce?: ReturnType<typeof setTimeout>;

  constructor() {
    void this.load();
    void this.loadCounts();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const result = await this.proposalsService.list({
        page: this.page(),
        pageSize: this.pageSize,
        status: this.statusFilter() || undefined,
        search: this.search().trim() || undefined
      });
      this.items.set(result.items);
      this.total.set(result.total);
    } catch (error) {
      console.error('No se pudieron cargar las propuestas.', error);
      this.loadError.set('No se pudieron cargar las propuestas. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  /** Conteos por estado para los chips — independientes de la búsqueda y la
   *  paginación actuales, se recargan solo cuando una acción puede haber
   *  cambiado la distribución (publicar/despublicar/eliminar), no en cada
   *  tecla de búsqueda. */
  private async loadCounts(): Promise<void> {
    try {
      this.counts.set(await this.proposalsService.countsByStatus());
    } catch (error) {
      console.error('No se pudieron cargar los conteos de propuestas.', error);
    }
  }

  thumbnailUrl(item: Proposal): string | null {
    return this.proposalImages.publicUrl(item.coverImagePath);
  }

  async setStatusFilter(status: ProposalStatus | ''): Promise<void> {
    this.statusFilter.set(status);
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
    return !!this.statusFilter() || !!this.search().trim();
  }

  async clearFilters(): Promise<void> {
    this.statusFilter.set('');
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

  toggleMenu(id: string): void {
    this.openMenuId.set(this.openMenuId() === id ? null : id);
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.openMenuId()) {
      return;
    }
    if (!(event.target as HTMLElement).closest('.proposals-list__menu')) {
      this.openMenuId.set(null);
    }
  }

  async publish(item: Proposal): Promise<void> {
    if (this.togglingId()) {
      return;
    }
    this.openMenuId.set(null);
    this.togglingId.set(item.id);
    this.actionError.set(null);
    try {
      await this.proposalsService.publish(item.id);
      await this.load();
      await this.loadCounts();
    } catch (error) {
      console.error('No se pudo publicar la propuesta.', error);
      // El backend es la autoridad sobre "está lista para publicar" —
      // error.message ya trae el detalle exacto de publish_proposal()
      // (p. ej. "Faltan datos para publicar: ..."), se muestra tal cual.
      this.actionError.set(error instanceof Error ? error.message : 'No se pudo publicar la propuesta.');
    } finally {
      this.togglingId.set(null);
    }
  }

  async unpublish(item: Proposal): Promise<void> {
    if (this.togglingId()) {
      return;
    }
    this.openMenuId.set(null);
    this.togglingId.set(item.id);
    this.actionError.set(null);
    try {
      await this.proposalsService.unpublish(item.id);
      await this.load();
      await this.loadCounts();
    } catch (error) {
      console.error('No se pudo despublicar la propuesta.', error);
      this.actionError.set('No se pudo despublicar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.togglingId.set(null);
    }
  }

  requestDelete(item: Proposal): void {
    this.openMenuId.set(null);
    this.actionError.set(null);
    this.proposalPendingDelete.set(item);
  }

  cancelDelete(): void {
    this.proposalPendingDelete.set(null);
  }

  async confirmDelete(): Promise<void> {
    const item = this.proposalPendingDelete();
    if (!item || this.deletingId()) {
      return;
    }
    this.proposalPendingDelete.set(null);
    this.deletingId.set(item.id);
    this.actionError.set(null);
    try {
      await this.proposalsService.remove(item.id);
      await this.load();
      await this.loadCounts();
    } catch (error) {
      console.error('No se pudo eliminar la propuesta.', error);
      this.actionError.set('No se pudo eliminar la propuesta. Inténtalo nuevamente.');
    } finally {
      this.deletingId.set(null);
    }
  }
}
