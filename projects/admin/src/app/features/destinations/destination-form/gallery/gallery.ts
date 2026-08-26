import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DestinationsService } from '../../../../core/services/destinations';
import { DestinationImagesService } from '../../../../core/services/destination-images';
import { Destination, DestinationImage } from '../../../../core/models/destination.model';
import { ImageUploader, ReadyImage } from '../../../../shared/ui/image-uploader/image-uploader';

@Component({
  selector: 'app-destination-gallery',
  imports: [DragDropModule, ImageUploader],
  templateUrl: './gallery.html',
  styleUrl: './gallery.css'
})
export class Gallery {
  private readonly route = inject(ActivatedRoute);
  private readonly destinationsService = inject(DestinationsService);
  private readonly imagesService = inject(DestinationImagesService);
  private readonly destinationId = this.route.parent!.snapshot.paramMap.get('id')!;

  readonly images = signal<DestinationImage[]>([]);
  readonly destination = signal<Destination | null>(null);
  readonly loading = signal(true);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly confirmingDeleteId = signal<string | null>(null);
  readonly editingAltId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    const [images, destination] = await Promise.all([
      this.imagesService.list(this.destinationId),
      this.destinationsService.getById(this.destinationId)
    ]);
    this.images.set(images);
    this.destination.set(destination);
    this.loading.set(false);
  }

  isCover(image: DestinationImage): boolean {
    return this.destination()?.coverImageId === image.id;
  }

  publicUrl(image: DestinationImage): string {
    return this.imagesService.publicUrl(image.storagePath);
  }

  async onFilesReady(files: ReadyImage[]): Promise<void> {
    this.uploading.set(true);
    this.uploadError.set(null);
    try {
      let position = this.images().length;
      for (const item of files) {
        const image = await this.imagesService.upload(this.destinationId, item.file, item.altText, position);
        this.images.update((images) => [...images, image]);
        position += 1;
      }
    } catch {
      this.uploadError.set('No se pudo subir una de las imágenes. Intenta de nuevo.');
    } finally {
      this.uploading.set(false);
    }
  }

  async setCover(image: DestinationImage): Promise<void> {
    await this.imagesService.setCover(this.destinationId, image.id);
    this.destination.update((d) => (d ? { ...d, coverImageId: image.id } : d));
  }

  async drop(event: CdkDragDrop<DestinationImage[]>): Promise<void> {
    const reordered = [...this.images()];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.images.set(reordered);
    await this.imagesService.reorder(reordered.map((image) => image.id));
  }

  startEditAlt(image: DestinationImage): void {
    this.editingAltId.set(image.id);
  }

  async saveAltText(image: DestinationImage, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).value.trim();
    this.editingAltId.set(null);
    if (!value || value === image.altText) {
      return;
    }
    await this.imagesService.updateAltText(image.id, value);
    this.images.update((images) => images.map((img) => (img.id === image.id ? { ...img, altText: value } : img)));
  }

  requestDelete(image: DestinationImage): void {
    if (this.confirmingDeleteId() === image.id) {
      void this.remove(image);
      return;
    }
    this.confirmingDeleteId.set(image.id);
  }

  private async remove(image: DestinationImage): Promise<void> {
    await this.imagesService.remove(image, this.isCover(image));
    this.images.update((images) => images.filter((i) => i.id !== image.id));
    if (this.isCover(image)) {
      this.destination.update((d) => (d ? { ...d, coverImageId: null } : d));
    }
    this.confirmingDeleteId.set(null);
  }
}
