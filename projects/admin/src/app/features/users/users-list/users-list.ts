import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { AdminUsersService } from '../../../core/services/admin-users';
import { ProfilesService } from '../../../core/services/profiles';
import { AdminUser } from '../../../core/models/user.model';
import { STAFF_ROLE_LABEL, StaffRole } from '../../../core/models/staff-role';
import { relativeTime } from '../../../core/utils/relative-time';
import { AdminPageHeader } from '../../../shared/ui/admin-page-header/admin-page-header';
import { AdminTable } from '../../../shared/ui/admin-table/admin-table';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';
import { UserFormModal, UserFormMode } from '../user-form-modal/user-form-modal';

const ROLE_OPTIONS: StaffRole[] = ['admin', 'editor', 'staff'];

@Component({
  selector: 'app-users-list',
  imports: [RouterLink, DatePipe, AdminPageHeader, AdminTable, AdminModal, UserFormModal],
  templateUrl: './users-list.html',
  styleUrl: './users-list.css'
})
export class UsersList {
  private readonly usersService = inject(AdminUsersService);
  private readonly profilesService = inject(ProfilesService);

  readonly roleOptions = ROLE_OPTIONS;
  readonly roleLabels = STAFF_ROLE_LABEL;

  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly users = signal<AdminUser[]>([]);
  readonly search = signal('');
  readonly savingId = signal<string | null>(null);

  readonly formOpen = signal(false);
  readonly formMode = signal<UserFormMode>('create');
  readonly formUser = signal<AdminUser | null>(null);

  readonly deleteTarget = signal<AdminUser | null>(null);
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);

  readonly filtered = computed(() => {
    const term = this.search().trim().toLowerCase();
    if (!term) {
      return this.users();
    }
    return this.users().filter(
      (user) => user.fullName.toLowerCase().includes(term) || user.email.toLowerCase().includes(term)
    );
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.users.set(await this.usersService.listUsers());
    } catch (error) {
      this.loadError.set(error instanceof Error ? error.message : 'No se pudo cargar la lista de usuarios.');
    } finally {
      this.loading.set(false);
    }
  }

  retry(): void {
    void this.load();
  }

  onSearchInput(event: Event): void {
    this.search.set((event.target as HTMLInputElement).value);
  }

  lastActive(user: AdminUser): string {
    return user.lastSignInAt ? relativeTime(user.lastSignInAt) : 'Nunca';
  }

  statusLabel(user: AdminUser): string {
    if (user.status === 'active') {
      return 'Activo';
    }
    return user.status === 'inactive' ? 'Inactivo' : 'Invitado';
  }

  statusBadgeClass(user: AdminUser): string {
    if (user.status === 'active') {
      return 'badge--success';
    }
    return user.status === 'inactive' ? 'badge--danger' : 'badge--warning';
  }

  async onRoleChange(user: AdminUser, event: Event): Promise<void> {
    const role = (event.target as HTMLSelectElement).value as StaffRole;
    if (role === user.role) {
      return;
    }

    this.savingId.set(user.id);
    try {
      await this.profilesService.updateRole(user.id, role);
      this.users.update((list) => list.map((u) => (u.id === user.id ? { ...u, role } : u)));
    } finally {
      this.savingId.set(null);
    }
  }

  openCreate(): void {
    this.formMode.set('create');
    this.formUser.set(null);
    this.formOpen.set(true);
  }

  openEdit(user: AdminUser): void {
    this.formMode.set('edit');
    this.formUser.set(user);
    this.formOpen.set(true);
  }

  closeForm(): void {
    this.formOpen.set(false);
  }

  onFormSaved(): void {
    this.formOpen.set(false);
    void this.load();
  }

  requestDelete(user: AdminUser): void {
    this.deleteError.set(null);
    this.deleteTarget.set(user);
  }

  cancelDelete(): void {
    if (this.deleting()) {
      return;
    }
    this.deleteTarget.set(null);
  }

  async confirmDelete(): Promise<void> {
    const target = this.deleteTarget();
    if (!target || this.deleting()) {
      return;
    }

    this.deleting.set(true);
    this.deleteError.set(null);
    try {
      await this.usersService.deleteUser(target.id);
      this.users.update((list) => list.filter((u) => u.id !== target.id));
      this.deleteTarget.set(null);
    } catch (error) {
      this.deleteError.set(error instanceof Error ? error.message : 'No se pudo eliminar el usuario.');
    } finally {
      this.deleting.set(false);
    }
  }
}
