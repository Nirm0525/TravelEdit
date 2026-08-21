import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../../core/services/auth';
import { DashboardData, DashboardService } from '../../core/services/dashboard';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css'
})
export class Dashboard {
  private readonly auth = inject(AuthService);
  private readonly dashboardService = inject(DashboardService);

  readonly profile = this.auth.profile;
  readonly loading = signal(true);
  readonly data = signal<DashboardData | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.data.set(await this.dashboardService.load());
    this.loading.set(false);
  }

  ageInDays(isoDate: string): number {
    const ms = Date.now() - new Date(isoDate).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
  }

  isStale(isoDate: string): boolean {
    const ms = Date.now() - new Date(isoDate).getTime();
    return ms > 48 * 60 * 60 * 1000;
  }
}
