import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DestinationsService } from '../../../../core/services/destinations';
import { ItineraryDay } from '../../../../core/models/destination.model';
import { ConfirmDialog } from '../../../../shared/ui/confirm-dialog/confirm-dialog';

type TextField = 'title' | 'description' | 'accommodation';

@Component({
  selector: 'app-destination-itinerary',
  imports: [DragDropModule, ConfirmDialog],
  templateUrl: './itinerary.html',
  styleUrl: './itinerary.css'
})
export class Itinerary {
  private readonly route = inject(ActivatedRoute);
  private readonly destinationsService = inject(DestinationsService);
  private readonly destinationId = this.route.parent!.snapshot.paramMap.get('id')!;

  readonly days = signal<ItineraryDay[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly savingOrder = signal(false);
  readonly addingDay = signal(false);
  readonly removingDayId = signal<string | null>(null);
  readonly itineraryError = signal<string | null>(null);
  readonly dayPendingDelete = signal<ItineraryDay | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      this.days.set(await this.destinationsService.listItineraryDays(this.destinationId));
    } catch (error) {
      console.error('No se pudo cargar el itinerario.', error);
      this.loadError.set('No se pudo cargar el itinerario. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  async addDay(): Promise<void> {
    if (this.addingDay()) {
      return;
    }
    this.addingDay.set(true);
    this.itineraryError.set(null);
    try {
      const day = await this.destinationsService.addItineraryDay(this.destinationId, this.days().length);
      this.days.update((days) => [...days, day]);
    } catch (error) {
      console.error('No se pudo agregar el día.', error);
      this.itineraryError.set('No se pudo agregar el día. Inténtalo nuevamente.');
    } finally {
      this.addingDay.set(false);
    }
  }

  requestRemoveDay(day: ItineraryDay): void {
    this.itineraryError.set(null);
    this.dayPendingDelete.set(day);
  }

  cancelRemoveDay(): void {
    this.dayPendingDelete.set(null);
  }

  async confirmRemoveDay(): Promise<void> {
    const day = this.dayPendingDelete();
    if (!day || this.removingDayId()) {
      return;
    }
    this.dayPendingDelete.set(null);
    this.removingDayId.set(day.id);
    this.itineraryError.set(null);

    try {
      // El día no desaparece del estado local hasta que Supabase confirme el
      // borrado — antes se quitaba de `days` incondicionalmente después del
      // await, así que un fallo del segundo paso (reorder) ya mostraba el
      // itinerario como si el día nunca hubiera existido, aunque siguiera en
      // la base. También un fallo del propio delete quedaba sin mensaje.
      await this.destinationsService.removeItineraryDay(day.id);
      const remaining = this.days().filter((d) => d.id !== day.id);
      this.days.set(remaining);

      if (remaining.length > 0) {
        await this.destinationsService.reorderItineraryDays(this.destinationId, remaining.map((d) => d.id));
      }
    } catch (error) {
      console.error('No se pudo eliminar el día del itinerario.', error);
      this.itineraryError.set('No se pudo eliminar el día. Inténtalo nuevamente.');
    } finally {
      this.removingDayId.set(null);
    }
  }

  async drop(event: CdkDragDrop<ItineraryDay[]>): Promise<void> {
    const previousOrder = this.days();
    const reordered = [...previousOrder];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.days.set(reordered);

    this.savingOrder.set(true);
    this.itineraryError.set(null);
    try {
      await this.destinationsService.reorderItineraryDays(
        this.destinationId,
        reordered.map((d) => d.id)
      );
    } catch (error) {
      console.error('No se pudo guardar el nuevo orden del itinerario.', error);
      // Vuelve al orden real de Supabase — antes el orden arrastrado quedaba
      // en pantalla aunque el RPC hubiera fallado, mostrando un orden que
      // nunca se guardó.
      this.days.set(previousOrder);
      this.itineraryError.set('No se pudo guardar el nuevo orden. Se restauró el orden anterior.');
    } finally {
      this.savingOrder.set(false);
    }
  }

  async onFieldBlur(day: ItineraryDay, field: TextField, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    this.itineraryError.set(null);
    try {
      const updated = await this.destinationsService.updateItineraryDay(day.id, { [field]: value });
      this.days.update((days) => days.map((d) => (d.id === day.id ? updated : d)));
    } catch (error) {
      console.error('No se pudo guardar el día del itinerario.', error);
      this.itineraryError.set('No se pudo guardar el día del itinerario. Inténtalo nuevamente.');
    }
  }

  async onExperiencesBlur(day: ItineraryDay, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).value;
    const experiences = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    this.itineraryError.set(null);
    try {
      const updated = await this.destinationsService.updateItineraryDay(day.id, { includedExperiences: experiences });
      this.days.update((days) => days.map((d) => (d.id === day.id ? updated : d)));
    } catch (error) {
      console.error('No se pudo guardar las experiencias del día.', error);
      this.itineraryError.set('No se pudo guardar el día del itinerario. Inténtalo nuevamente.');
    }
  }
}
