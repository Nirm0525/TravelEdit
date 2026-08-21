import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { DestinationsService } from '../../../core/services/destinations';
import { Destination } from '../../../core/models/destination.model';
import { DestinationStatus } from '../../../core/models/destination-enums';
import { DESTINATION_STATUS_LABEL } from '../../../core/data/destination-options';
import { AuthService } from '../../../core/services/auth';

@Component({
  selector: 'app-destination-form',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './destination-form.html',
  styleUrl: './destination-form.css'
})
export class DestinationForm {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destinationsService = inject(DestinationsService);
  private readonly auth = inject(AuthService);

  readonly statusLabel = DESTINATION_STATUS_LABEL;
  readonly destination = signal<Destination | null>(null);
  readonly loading = signal(true);
  readonly isAdmin = this.auth.isAdmin;
  readonly deleteConfirmText = signal('');
  readonly deleting = signal(false);

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.load(id);
    }
  }

  private async load(id: string): Promise<void> {
    this.loading.set(true);
    this.destination.set(await this.destinationsService.getById(id));
    this.loading.set(false);
  }

  async setStatus(status: DestinationStatus): Promise<void> {
    const current = this.destination();
    if (!current) {
      return;
    }
    this.destination.set(await this.destinationsService.updateStatus(current.id, status));
  }

  onDeleteConfirmInput(event: Event): void {
    this.deleteConfirmText.set((event.target as HTMLInputElement).value);
  }

  canDelete(): boolean {
    const current = this.destination();
    return !!current && this.deleteConfirmText() === current.title;
  }

  async remove(): Promise<void> {
    const current = this.destination();
    if (!current || !this.canDelete() || this.deleting()) {
      return;
    }

    this.deleting.set(true);
    try {
      await this.destinationsService.remove(current.id);
      await this.router.navigateByUrl('/destinos');
    } finally {
      this.deleting.set(false);
    }
  }
}
