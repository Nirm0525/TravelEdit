import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { DestinationsService } from '../../../../core/services/destinations';
import { DestinationImagesService } from '../../../../core/services/destination-images';
import { Destination, DestinationImage } from '../../../../core/models/destination.model';

interface PendingUpload {
  id: string;
  file: File;
  altText: string;
  previewUrl: string;
}

@Component({
  selector: 'app-destination-gallery',
  imports: [DragDropModule],
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
  readonly pending = signal<PendingUpload[]>([]);
  readonly uploading = signal(false);
  readonly confirmingDeleteId = signal<string | null>(null);

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

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files) {
      return;
    }

    const additions: PendingUpload[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      altText: '',
      previewUrl: URL.createObjectURL(file)
    }));

    this.pending.update((current) => [...current, ...additions]);
    input.value = '';
  }

  onPendingAltInput(pendingId: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pending.update((items) => items.map((item) => (item.id === pendingId ? { ...item, altText: value } : item)));
  }

  discardPending(pendingId: string): void {
    const item = this.pending().find((p) => p.id === pendingId);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.pending.update((items) => items.filter((p) => p.id !== pendingId));
  }

  canUploadPending(): boolean {
    const items = this.pending();
    return items.length > 0 && items.every((item) => item.altText.trim().length > 0);
  }

  async uploadPending(): Promise<void> {
    if (!this.canUploadPending() || this.uploading()) {
      return;
    }

    this.uploading.set(true);
    try {
      let position = this.images().length;
      for (const item of this.pending()) {
        const image = await this.imagesService.upload(this.destinationId, item.file, item.altText.trim(), position);
        this.images.update((images) => [...images, image]);
        URL.revokeObjectURL(item.previewUrl);
        position += 1;
      }
      this.pending.set([]);
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
