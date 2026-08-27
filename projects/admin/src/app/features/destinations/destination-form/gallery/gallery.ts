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
  readonly loadError = signal<string | null>(null);
  readonly uploading = signal(false);
  readonly uploadError = signal<string | null>(null);
  readonly galleryError = signal<string | null>(null);
  readonly reordering = signal(false);
  readonly confirmingDeleteId = signal<string | null>(null);
  readonly deletingId = signal<string | null>(null);
  readonly settingCoverId = signal<string | null>(null);
  readonly editingAltId = signal<string | null>(null);

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const [images, destination] = await Promise.all([
        this.imagesService.list(this.destinationId),
        this.destinationsService.getById(this.destinationId)
      ]);
      this.images.set(images);
      this.destination.set(destination);
    } catch (error) {
      console.error('No se pudo cargar la galería.', error);
      this.loadError.set('No se pudo cargar la galería. Inténtalo nuevamente.');
    } finally {
      this.loading.set(false);
    }
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
    } catch (error) {
      console.error('No se pudo subir una de las imágenes.', error);
      this.uploadError.set('No se pudo subir una de las imágenes. Intenta de nuevo.');
    } finally {
      this.uploading.set(false);
    }
  }

  async setCover(image: DestinationImage): Promise<void> {
    if (this.settingCoverId()) {
      return;
    }
    this.settingCoverId.set(image.id);
    this.galleryError.set(null);
    try {
      await this.imagesService.setCover(this.destinationId, image.id);
      this.destination.update((d) => (d ? { ...d, coverImageId: image.id } : d));
    } catch (error) {
      console.error('No se pudo marcar la portada.', error);
      this.galleryError.set('No se pudo marcar la imagen como portada. Inténtalo nuevamente.');
    } finally {
      this.settingCoverId.set(null);
    }
  }

  async drop(event: CdkDragDrop<DestinationImage[]>): Promise<void> {
    const previousOrder = this.images();
    const reordered = [...previousOrder];
    moveItemInArray(reordered, event.previousIndex, event.currentIndex);
    this.images.set(reordered);

    this.reordering.set(true);
    this.galleryError.set(null);
    try {
      await this.imagesService.reorder(reordered.map((image) => image.id));
    } catch (error) {
      console.error('No se pudo guardar el nuevo orden de la galería.', error);
      // Igual que en itinerario: si el reorder falla, se vuelve al orden real
      // en vez de dejar en pantalla un orden que nunca se guardó.
      this.images.set(previousOrder);
      this.galleryError.set('No se pudo guardar el nuevo orden. Se restauró el orden anterior.');
    } finally {
      this.reordering.set(false);
    }
  }

  startEditAlt(image: DestinationImage): void {
    this.galleryError.set(null);
    this.editingAltId.set(image.id);
  }

  async saveAltText(image: DestinationImage, event: Event): Promise<void> {
    const value = (event.target as HTMLInputElement).value.trim();
    this.editingAltId.set(null);
    if (!value || value === image.altText) {
      return;
    }
    try {
      await this.imagesService.updateAltText(image.id, value);
      this.images.update((images) => images.map((img) => (img.id === image.id ? { ...img, altText: value } : img)));
    } catch (error) {
      console.error('No se pudo guardar el texto alternativo.', error);
      this.galleryError.set('No se pudo guardar el texto alternativo. Inténtalo nuevamente.');
    }
  }

  requestDelete(image: DestinationImage): void {
    if (this.confirmingDeleteId() === image.id) {
      void this.remove(image);
      return;
    }
    this.galleryError.set(null);
    this.confirmingDeleteId.set(image.id);
  }

  private async remove(image: DestinationImage): Promise<void> {
    if (this.deletingId()) {
      return;
    }
    this.deletingId.set(image.id);
    this.galleryError.set(null);
    try {
      await this.imagesService.remove(image, this.isCover(image));
      this.images.update((images) => images.filter((i) => i.id !== image.id));
      if (this.isCover(image)) {
        this.destination.update((d) => (d ? { ...d, coverImageId: null } : d));
      }
      this.confirmingDeleteId.set(null);
    } catch (error) {
      console.error('No se pudo eliminar la imagen.', error);
      this.galleryError.set('No se pudo eliminar la imagen. Inténtalo nuevamente.');
      this.confirmingDeleteId.set(null);
    } finally {
      this.deletingId.set(null);
    }
  }
}
