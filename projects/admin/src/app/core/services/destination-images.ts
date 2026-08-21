import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { DestinationImage, toDestinationImage } from '../models/destination.model';

const BUCKET = 'destination-images';
const MAX_DIMENSION = 2000;
const WEBP_QUALITY = 0.82;

async function compressImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('No se pudo procesar la imagen en este navegador.');
  }
  context.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('No se pudo comprimir la imagen.'))),
      'image/webp',
      WEBP_QUALITY
    );
  });
}

@Injectable({
  providedIn: 'root'
})
export class DestinationImagesService {
  private readonly supabase = inject(SupabaseService);

  publicUrl(storagePath: string): string {
    return this.supabase.client.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }

  async list(destinationId: string): Promise<DestinationImage[]> {
    const { data, error } = await this.supabase.client
      .from('destination_images')
      .select('*')
      .eq('destination_id', destinationId)
      .order('position', { ascending: true });

    if (error) {
      throw error;
    }
    return (data ?? []).map(toDestinationImage);
  }

  async upload(destinationId: string, file: File, altText: string, position: number): Promise<DestinationImage> {
    const compressed = await compressImage(file);
    const storagePath = `${destinationId}/${crypto.randomUUID()}.webp`;

    const { error: uploadError } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(storagePath, compressed, { contentType: 'image/webp' });

    if (uploadError) {
      throw uploadError;
    }

    const { data, error } = await this.supabase.client
      .from('destination_images')
      .insert({ destination_id: destinationId, storage_path: storagePath, alt_text: altText, position })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toDestinationImage(data);
  }

  async updateAltText(id: string, altText: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('destination_images')
      .update({ alt_text: altText })
      .eq('id', id);

    if (error) {
      throw error;
    }
  }

  /** Sin garantía de atomicidad entre filas: el orden de la galería es cosmético,
   *  no crítico como el itinerario, así que no justifica una función RPC. */
  async reorder(orderedIds: string[]): Promise<void> {
    await Promise.all(
      orderedIds.map((id, index) =>
        this.supabase.client.from('destination_images').update({ position: index }).eq('id', id)
      )
    );
  }

  async setCover(destinationId: string, imageId: string | null): Promise<void> {
    const { error } = await this.supabase.client
      .from('destinations')
      .update({ cover_image_id: imageId })
      .eq('id', destinationId);

    if (error) {
      throw error;
    }
  }

  async remove(image: DestinationImage, isCover: boolean): Promise<void> {
    if (isCover) {
      await this.setCover(image.destinationId, null);
    }

    const { error: storageError } = await this.supabase.client.storage.from(BUCKET).remove([image.storagePath]);
    if (storageError) {
      throw storageError;
    }

    const { error } = await this.supabase.client.from('destination_images').delete().eq('id', image.id);
    if (error) {
      throw error;
    }
  }
}
