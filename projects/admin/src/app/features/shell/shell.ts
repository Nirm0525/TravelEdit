import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { AuthService } from '../../core/services/auth';
import { AdminSidebar } from '../../shared/ui/admin-sidebar/admin-sidebar';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, AdminSidebar],
  templateUrl: './shell.html',
  styleUrl: './shell.css'
})
export class Shell {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly profile = this.auth.profile;
  readonly mobileSidebarOpen = signal(false);
  readonly pageTitle = signal('');

  constructor() {
    this.updateTitle();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe(() => this.updateTitle());
  }

  async signOut(): Promise<void> {
    await this.auth.signOut();
    await this.router.navigateByUrl('/login');
  }

  private updateTitle(): void {
    let current = this.route;
    let title = '';
    while (current.firstChild) {
      current = current.firstChild;
      title = (current.snapshot.data['title'] as string | undefined) ?? title;
    }
    this.pageTitle.set(title);
  }
}
