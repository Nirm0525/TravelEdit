import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

const BUCKET = 'article-covers';
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
export class ArticleImagesService {
  private readonly supabase = inject(SupabaseService);

  /** Devuelve el storage_path relativo (no la URL) — así se guarda en `cover_storage_path`,
   *  igual que destination_images, y se resuelve a URL pública recién al mostrarla. */
  async uploadCover(file: File): Promise<string> {
    const compressed = await compressImage(file);
    const storagePath = `covers/${crypto.randomUUID()}.webp`;

    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(storagePath, compressed, { contentType: 'image/webp' });

    if (error) {
      throw error;
    }
    return storagePath;
  }

  /** Para imágenes insertadas dentro del cuerpo del artículo vía el editor de texto
   *  enriquecido — ahí sí hace falta la URL completa de inmediato. */
  async uploadBodyImage(file: File): Promise<string> {
    const storagePath = await this.uploadCover(file);
    return this.resolveUrl(storagePath)!;
  }

  /** Los 3 artículos migrados desde site_content.the_edit guardan `cover_storage_path`
   *  como una URL completa (a site-content-images o a Unsplash), no un path relativo a
   *  este bucket — hay que distinguirlos antes de llamar a getPublicUrl(). */
  resolveUrl(pathOrUrl: string | null): string | null {
    if (!pathOrUrl) {
      return null;
    }
    if (pathOrUrl.startsWith('http')) {
      return pathOrUrl;
    }
    return this.supabase.client.storage.from(BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  }
}
