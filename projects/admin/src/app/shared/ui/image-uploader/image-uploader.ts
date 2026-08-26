import { Component, input, output, signal } from '@angular/core';

export interface StagedImage {
  id: string;
  file: File;
  altText: string;
  previewUrl: string;
}

export interface ReadyImage {
  file: File;
  altText: string;
}

/**
 * Selección + staging + preview de imágenes antes de subirlas — no sabe nada
 * de Supabase/buckets/tablas, así que sirve igual para destination-images,
 * site-content-images o article-covers: el que lo usa decide a dónde y cómo
 * sube cada archivo cuando recibe `filesReady`.
 */
@Component({
  selector: 'app-image-uploader',
  templateUrl: './image-uploader.html',
  styleUrl: './image-uploader.css'
})
export class ImageUploader {
  readonly multiple = input(true);
  readonly requireAltText = input(true);
  readonly confirmLabel = input('Subir imagen(es)');
  readonly disabled = input(false);

  readonly filesReady = output<ReadyImage[]>();

  readonly pending = signal<StagedImage[]>([]);

  onFilesSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = input.files;
    if (!files) {
      return;
    }

    const additions: StagedImage[] = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      altText: '',
      previewUrl: URL.createObjectURL(file)
    }));

    this.pending.update((current) => [...current, ...additions]);
    input.value = '';
  }

  onAltTextInput(id: string, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pending.update((items) => items.map((item) => (item.id === id ? { ...item, altText: value } : item)));
  }

  discard(id: string): void {
    const item = this.pending().find((p) => p.id === id);
    if (item) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.pending.update((items) => items.filter((p) => p.id !== id));
  }

  canConfirm(): boolean {
    const items = this.pending();
    if (items.length === 0) {
      return false;
    }
    return !this.requireAltText() || items.every((item) => item.altText.trim().length > 0);
  }

  confirm(): void {
    if (!this.canConfirm()) {
      return;
    }
    const ready = this.pending().map((item) => ({ file: item.file, altText: item.altText.trim() }));
    for (const item of this.pending()) {
      URL.revokeObjectURL(item.previewUrl);
    }
    this.pending.set([]);
    this.filesReady.emit(ready);
  }
}
