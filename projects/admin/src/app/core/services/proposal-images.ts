import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

const BUCKET = 'proposal-images';
const MAX_DIMENSION = 2400;
const WEBP_QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(['image/webp', 'image/jpeg', 'image/png']);

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

/**
 * proposal-images es exclusivamente para fotografía editorial reutilizable
 * en una propuesta (hoteles, ciudades, vehículos, experiencias,
 * restaurantes) — ver supabase/migrations/0034_proposal_images_bucket.sql.
 * Nunca debe usarse para documentos personales, pasaportes ni vouchers: este
 * servicio no ofrece (ni debe ofrecer desde ningún componente) un selector
 * de archivos genérico, solo el flujo de imagen de portada/día como
 * ArticleImagesService/DestinationImagesService.
 */
@Injectable({
  providedIn: 'root'
})
export class ProposalImagesService {
  private readonly supabase = inject(SupabaseService);

  /** Devuelve el storage_path relativo (no la URL) — se guarda tal cual en
   *  content.cover.imagePath / content.days[].imagePath, y se resuelve a URL
   *  pública recién al mostrarla vía getPublicUrl(). */
  async upload(file: File): Promise<string> {
    if (!ACCEPTED_MIME_TYPES.has(file.type)) {
      throw new Error('Formato no permitido. Usa una imagen WEBP, JPEG o PNG.');
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error('La imagen supera el máximo de 10 MB.');
    }

    const compressed = await compressImage(file);
    const storagePath = `${crypto.randomUUID()}.webp`;

    const { error } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(storagePath, compressed, { contentType: 'image/webp' });

    if (error) {
      throw error;
    }
    return storagePath;
  }

  async remove(storagePath: string): Promise<void> {
    const { error } = await this.supabase.client.storage.from(BUCKET).remove([storagePath]);
    if (error) {
      throw error;
    }
  }

  publicUrl(storagePath: string | null): string | null {
    if (!storagePath) {
      return null;
    }
    return this.supabase.client.storage.from(BUCKET).getPublicUrl(storagePath).data.publicUrl;
  }
}
