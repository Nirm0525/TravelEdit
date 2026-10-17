import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { AdvisorDashboardData, DashboardData, DashboardService } from '../../core/services/dashboard';
import { relativeTime } from '../../core/utils/relative-time';
import { AdminPageHeader } from '../../shared/ui/admin-page-header/admin-page-header';
import { AdminTable } from '../../shared/ui/admin-table/admin-table';
import { AdminSkeleton } from '../../shared/ui/admin-skeleton/admin-skeleton';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, AdminPageHeader, AdminTable, AdminSkeleton],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);

  readonly profile = this.auth.profile;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly data = signal<DashboardData | null>(null);
  readonly advisorData = signal<AdvisorDashboardData | null>(null);
  /** La asesora (rol staff) ve un dashboard propio: sus solicitudes y propuestas. */
  readonly isAdvisor = computed(() => this.profile()?.role === 'staff');

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      await this.auth.ready();
      if (this.isAdvisor()) {
        this.advisorData.set(await this.dashboardService.loadAdvisor());
      } else {
        this.data.set(await this.dashboardService.load());
      }
    } catch (error) {
      console.error('No se pudo cargar el dashboard.', error);
      this.loadError.set('No se pudo cargar el dashboard. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(status: string): string {
    const labels: Record<string, string> = {
      draft: 'Borrador',
      published: 'Enviada',
      viewed: 'Vista por el cliente',
      accepted: 'Aceptada',
      expired: 'Vencida'
    };
    return labels[status] ?? status;
  }

  ageInDays(isoDate: string): number {
    const ms = Date.now() - new Date(isoDate).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  isStale(isoDate: string): boolean {
    const ms = Date.now() - new Date(isoDate).getTime();
    return ms > 48 * 60 * 60 * 1000;
  }

  relativeTime(isoDate: string): string {
    return relativeTime(isoDate);
  }
}
