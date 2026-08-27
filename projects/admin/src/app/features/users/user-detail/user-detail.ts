import { Component, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { ActivatedRoute } from '@angular/router';
import { AdminUsersService } from '../../../core/services/admin-users';
import { AuditLogItem, AuditLogService } from '../../../core/services/audit-log';
import { AdminUser } from '../../../core/models/user.model';
import { STAFF_ROLE_LABEL } from '../../../core/models/staff-role';
import { relativeTime } from '../../../core/utils/relative-time';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { AdminTable } from '../../../shared/ui/admin-table/admin-table';

@Component({
  selector: 'app-user-detail',
  imports: [DatePipe, AdminPageHeader, AdminTable],
  templateUrl: './user-detail.html',
  styleUrl: './user-detail.css'
})
export class UserDetail {
  private readonly route = inject(ActivatedRoute);
  private readonly usersService = inject(AdminUsersService);
  private readonly auditLog = inject(AuditLogService);
  private readonly userId = this.route.snapshot.paramMap.get('id')!;

  readonly roleLabels = STAFF_ROLE_LABEL;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly user = signal<AdminUser | null>(null);
  readonly activity = signal<AuditLogItem[]>([]);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [users, activity] = await Promise.all([
        this.usersService.listUsers(),
        this.auditLog.listByActor(this.userId, 20)
      ]);
      this.user.set(users.find((u) => u.id === this.userId) ?? null);
      this.activity.set(activity);
    } catch (error) {
      console.error('No se pudo cargar el detalle del usuario.', error);
      this.loadError.set(error instanceof Error ? error.message : 'No se pudo cargar el detalle del usuario.');
    } finally {
      this.loading.set(false);
    }
  }

  lastActive(user: AdminUser): string {
    return user.lastSignInAt ? relativeTime(user.lastSignInAt) : 'Nunca';
  }

  statusLabel(user: AdminUser): string {
    return user.status === 'active' ? 'Activo' : 'Invitado';
  }

  statusBadgeClass(user: AdminUser): string {
    return user.status === 'active' ? 'badge--success' : 'badge--warning';
  }

  relativeTime(isoDate: string): string {
    return relativeTime(isoDate);
  }
}
