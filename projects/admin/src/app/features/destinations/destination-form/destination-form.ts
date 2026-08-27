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
  readonly loadError = signal<string | null>(null);
  readonly isAdmin = this.auth.isAdmin;
  readonly deleteConfirmText = signal('');
  readonly deleting = signal(false);
  readonly deleteError = signal<string | null>(null);
  readonly statusUpdating = signal(false);
  readonly statusError = signal<string | null>(null);

  readonly destinationId: string | null;

  constructor() {
    this.destinationId = this.route.snapshot.paramMap.get('id');
    if (this.destinationId) {
      void this.load(this.destinationId);
    } else {
      this.loading.set(false);
    }
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.destination.set(await this.destinationsService.getById(id));
    } catch (error) {
      console.error('No se pudo cargar el destino.', error);
      this.loadError.set('No se pudo cargar el destino. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  async setStatus(status: DestinationStatus): Promise<void> {
    const current = this.destination();
    if (!current || this.statusUpdating()) {
      return;
    }
    this.statusUpdating.set(true);
    this.statusError.set(null);
    try {
      this.destination.set(await this.destinationsService.updateStatus(current.id, status));
    } catch (error) {
      console.error('No se pudo actualizar el estado del destino.', error);
      this.statusError.set('No se pudo actualizar el estado del destino. Inténtalo nuevamente.');
    } finally {
      this.statusUpdating.set(false);
    }
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
    this.deleteError.set(null);
    try {
      await this.destinationsService.remove(current.id);
      await this.router.navigateByUrl('/destinos');
    } catch (error) {
      console.error('No se pudo eliminar el destino.', error);
      this.deleteError.set('No se pudo eliminar el destino. Inténtalo nuevamente.');
    } finally {
      this.deleting.set(false);
    }
  }
}
