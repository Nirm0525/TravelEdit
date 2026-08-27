import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { DestinationsService } from '../../../../core/services/destinations';
import { DestinationImagesService } from '../../../../core/services/destination-images';
import { Destination, DestinationImage, ItineraryDay } from '../../../../core/models/destination.model';
import { TRIP_TYPE_OPTIONS } from '../../../../core/data/destination-options';

@Component({
  selector: 'app-destination-preview',
  imports: [],
  templateUrl: './preview.html',
  styleUrl: './preview.css'
})
export class Preview {
  private readonly route = inject(ActivatedRoute);
  private readonly destinationsService = inject(DestinationsService);
  private readonly imagesService = inject(DestinationImagesService);
  private readonly destinationId = this.route.parent!.snapshot.paramMap.get('id')!;

  readonly destination = signal<Destination | null>(null);
  readonly days = signal<ItineraryDay[]>([]);
  readonly images = signal<DestinationImage[]>([]);
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [destination, days, images] = await Promise.all([
        this.destinationsService.getById(this.destinationId),
        this.destinationsService.listItineraryDays(this.destinationId),
        this.imagesService.list(this.destinationId)
      ]);
      this.destination.set(destination);
      this.days.set(days);
      this.images.set(images);
    } catch (error) {
      console.error('No se pudo cargar la vista previa.', error);
      this.loadError.set('No se pudo cargar la vista previa. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
  }

  publicUrl(image: DestinationImage): string {
    return this.imagesService.publicUrl(image.storagePath);
  }

  coverUrl(): string | null {
    const d = this.destination();
    if (!d?.coverImageId) {
      const firstImage = this.images()[0];
      return firstImage ? this.publicUrl(firstImage) : null;
    }
    const cover = this.images().find((image) => image.id === d.coverImageId);
    return cover ? this.publicUrl(cover) : null;
  }

  tripTypeLabel(): string {
    const d = this.destination();
    return TRIP_TYPE_OPTIONS.find((option) => option.value === d?.tripType)?.label ?? '';
  }

  priceRangeLabel(): string {
    const d = this.destination();
    if (!d || (d.priceRangeMin == null && d.priceRangeMax == null)) {
      return 'Precio a consultar';
    }
    if (d.priceRangeMin != null && d.priceRangeMax != null) {
      return `Desde $${d.priceRangeMin} hasta $${d.priceRangeMax}`;
    }
    return `Desde $${d.priceRangeMin ?? d.priceRangeMax}`;
  }
}
