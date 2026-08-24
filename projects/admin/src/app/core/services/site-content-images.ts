import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

const BUCKET = 'site-content-images';
const MAX_DIMENSION = 2400;
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
export class SiteContentImagesService {
  private readonly supabase = inject(SupabaseService);

  async uploadHeroImage(file: File): Promise<string> {
    const compressed = await compressImage(file);
    const storagePath = `hero/${crypto.randomUUID()}.webp`;

    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(storagePath, compressed, { contentType: 'image/webp' });

    if (error) {
      throw error;
    }
    return this.supabase.client.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }
}
