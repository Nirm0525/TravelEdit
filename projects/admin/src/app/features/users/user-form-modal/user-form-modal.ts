import { Component, effect, inject, input, output, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';
import { AdminUsersService } from '../../../core/services/admin-users';
import { AdminUser } from '../../../core/models/user.model';
import { STAFF_ROLE_LABEL, StaffRole } from '../../../core/models/staff-role';

export type UserFormMode = 'create' | 'edit';

@Component({
  selector: 'app-user-form-modal',
  imports: [ReactiveFormsModule, AdminModal],
  templateUrl: './user-form-modal.html',
  styleUrl: './user-form-modal.css'
})
export class UserFormModal {
  private readonly fb = inject(NonNullableFormBuilder);
  private readonly usersService = inject(AdminUsersService);

  readonly open = input(false);
  readonly mode = input.required<UserFormMode>();
  readonly user = input<AdminUser | null>(null);

  readonly closed = output<void>();
  readonly saved = output<void>();

  readonly roleOptions: StaffRole[] = ['admin', 'editor', 'staff'];
  readonly roleLabels = STAFF_ROLE_LABEL;

  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  readonly form = this.fb.group({
    fullName: this.fb.control('', Validators.required),
    email: this.fb.control('', [Validators.required, Validators.email]),
    role: this.fb.control<StaffRole>('editor', Validators.required),
    status: this.fb.control<'active' | 'inactive'>('active', Validators.required)
  });

  constructor() {
    effect(() => {
      if (!this.open()) {
        return;
      }
      this.error.set(null);
      const current = this.user();
      if (this.mode() === 'edit' && current) {
        this.form.patchValue({
          fullName: current.fullName,
          email: current.email,
          role: current.role,
          status: current.status === 'inactive' ? 'inactive' : 'active'
        });
      } else {
        this.form.reset({ fullName: '', email: '', role: 'editor', status: 'active' });
      }
    });
  }

  get title(): string {
    return this.mode() === 'edit' ? 'Editar usuario' : 'Agregar usuario';
  }

  close(): void {
    if (this.saving()) {
      return;
    }
    this.closed.emit();
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.saving()) {
      this.form.markAllAsTouched();
      return;
    }

    this.saving.set(true);
    this.error.set(null);
    const value = this.form.getRawValue();

    try {
      if (this.mode() === 'edit' && this.user()) {
        await this.usersService.updateUser({ userId: this.user()!.id, ...value });
      } else {
        await this.usersService.createUser(value);
      }
      this.saved.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'No se pudo guardar el usuario.');
    } finally {
      this.saving.set(false);
    }
  }
}
