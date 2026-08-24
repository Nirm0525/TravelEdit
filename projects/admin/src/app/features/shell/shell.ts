import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { AdminSidebar } from '../../shared/ui/admin-sidebar/admin-sidebar';
import { STAFF_ROLE_LABEL, StaffRole } from '../../core/models/staff-role';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AdminSidebar],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly profile = this.auth.profile;
  readonly mobileSidebarOpen = signal(false);
  readonly pageTitle = signal('');

  constructor() {
    this.updateTitle();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.updateTitle());
  }

  roleLabel(role: StaffRole): string {
    return STAFF_ROLE_LABEL[role];
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  private updateTitle(): void {
    // Se recorre el snapshot del router (siempre completamente enlazado, con
    // `.data` garantizado en cada nodo), no las ActivatedRoute "vivas" — esas
    // todavía no tienen su snapshot resuelto en este punto del ciclo de vida.
    let current = this.router.routerState.snapshot.root;
    let title = '';
    while (current.firstChild) {
      current = current.firstChild;
      title = (current.data['title'] as string | undefined) ?? title;
    }
    this.pageTitle.set(title);
  }
}
