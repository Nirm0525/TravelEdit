import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DestinationsService } from '../../../../core/services/destinations';
import { ItineraryDay } from '../../../../core/models/destination.model';

type TextField = 'title' | 'description' | 'accommodation';

@Component({
  selector: 'app-destination-itinerary',
  imports: [DragDropModule],
  templateUrl: './itinerary.html',
  styleUrl: './itinerary.css'
})
export class Itinerary {
  private readonly route = inject(ActivatedRoute);
  private readonly destinationsService = inject(DestinationsService);
  private readonly destinationId = this.route.parent!.snapshot.paramMap.get('id')!;

  readonly days = signal<ItineraryDay[]>([]);
  readonly loading = signal(true);
  readonly savingOrder = signal(false);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.days.set(await this.destinationsService.listItineraryDays(this.destinationId));
    this.loading.set(false);
  }

  async addDay(): Promise<void> {
    const day = await this.destinationsService.addItineraryDay(this.destinationId, this.days().length);
    this.days.update((days) => [...days, day]);
  }

  async removeDay(day: ItineraryDay): Promise<void> {
    await this.destinationsService.removeItineraryDay(day.id);
    const remaining = this.days().filter((d) => d.id !== day.id);
    this.days.set(remaining);

    if (remaining.length > 0) {
      await this.destinationsService.reorderItineraryDays(this.destinationId, remaining.map((d) => d.id));
    }
  }

  async drop(event: CdkDragDrop<ItineraryDay[]>): Promise<void> {
    const reordered = [...this.days()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.days.set(reordered);

    this.savingOrder.set(true);
    try {
      await this.destinationsService.reorderItineraryDays(
        this.destinationId,
        reordered.map((d) => d.id)
      );
    } finally {
      this.savingOrder.set(false);
    }
  }

  onFieldBlur(day: ItineraryDay, field: TextField, event: Event): void {
    const value = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    void this.destinationsService.updateItineraryDay(day.id, { [field]: value });
  }

  onExperiencesBlur(day: ItineraryDay, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const experiences = value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

    void this.destinationsService.updateItineraryDay(day.id, { includedExperiences: experiences });
    this.days.update((days) =>
      days.map((d) => (d.id === day.id ? { ...d, includedExperiences: experiences } : d))
    );
  }
}
