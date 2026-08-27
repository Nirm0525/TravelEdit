import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { SettingsService } from '../../../core/services/settings';
import { environment } from '../../../../environments/environment';
import { AdminPageHeader, BreadcrumbItem } from '../../../shared/ui/admin-page-header/admin-page-header';
import { AdminSkeleton } from '../../../shared/ui/admin-skeleton/admin-skeleton';
import { StatusBadge } from '../../../shared/ui/status-badge/status-badge';

@Component({
  selector: 'app-security-settings',
  imports: [AdminPageHeader, AdminSkeleton, StatusBadge, DatePipe],
  templateUrl: './security-settings.html',
  styleUrl: './security-settings.css'
})
export class SecuritySettings {
  private readonly settings = inject(SettingsService);

  readonly breadcrumb: BreadcrumbItem[] = [
    { label: 'Panel', link: '/dashboard' },
    { label: 'Configuración', link: '/configuracion' },
    { label: 'Seguridad' }
  ];

  // El admin y el sitio público son bundles separados (ver comentario en
  // environment.ts del admin) — la Turnstile site key (pública) vive solo en
  // el environment del sitio público. Aquí solo se puede verificar de forma
  // segura si el secret server-side está configurado.
  readonly supabaseUrl = environment.supabaseUrl;

  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly resendConfigured = signal<boolean | null>(null);
  readonly turnstileSecretConfigured = signal<boolean | null>(null);
  readonly checkedAt = signal<Date | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const status = await this.settings.getIntegrationStatus();
      this.resendConfigured.set(status.resendConfigured);
      this.turnstileSecretConfigured.set(status.turnstileSecretConfigured);
      this.checkedAt.set(new Date());
    } catch (err) {
      console.error('No se pudo consultar el estado de seguridad.', err);
      this.error.set(err instanceof Error ? err.message : 'No pudimos consultar el estado de las integraciones.');
    } finally {
      this.loading.set(false);
    }
  }
}
