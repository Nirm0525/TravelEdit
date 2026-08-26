import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { Destination } from '../data/destinations';

const DESTINATION_IMAGES_BUCKET = 'destination-images';

interface DestinationRow {
  id: string;
  slug: string;
  title: string;
  country_region: string;
  cover_image_id: string | null;
}

interface DestinationImageRow {
  id: string;
  storage_path: string;
  alt_text: string;
}

/**
 * Resuelve destinos reales (tabla `destinations`, administrada desde el CMS) para la
 * sección "Destinos destacados" del Home. `destinations_select` (RLS) ya solo deja
 * leer filas `status = 'published'` a un usuario anónimo, así que un ID archivado o
 * en borrador simplemente no vuelve en el resultado — sin necesidad de filtrar aquí.
 */
@Injectable({
  providedIn: 'root'
})
export class PublicDestinationsService {
  private readonly supabase = inject(SupabaseService);

  async getByIds(ids: string[]): Promise<Destination[]> {
    if (ids.length === 0) {
      return [];
    }

    const { data: destinations, error } = await this.supabase.client
      .from('destinations')
      .select('id, slug, title, country_region, cover_image_id')
      .in('id', ids);

    if (error || !destinations) {
      return [];
    }

    const coverImageIds = destinations
      .map((d: DestinationRow) => d.cover_image_id)
      .filter((id: string | null): id is string => !!id);

    const imagesByCoverId = new Map<string, DestinationImageRow>();
    if (coverImageIds.length > 0) {
      const { data: images } = await this.supabase.client
        .from('destination_images')
        .select('id, storage_path, alt_text')
        .in('id', coverImageIds);
      for (const image of images ?? []) {
        imagesByCoverId.set(image.id, image);
      }
    }

    const byId = new Map(
      destinations.map((row: DestinationRow) => {
        const cover = row.cover_image_id ? imagesByCoverId.get(row.cover_image_id) : null;
        if (!cover) {
          return [row.id, null] as const;
        }
        const destination: Destination = {
          slug: row.slug,
          name: row.title,
          country: row.country_region,
          image: this.supabase.client.storage.from(DESTINATION_IMAGES_BUCKET).getPublicUrl(cover.storage_path).data
            .publicUrl,
          alt: cover.alt_text
        };
        return [row.id, destination] as const;
      })
    );

    return ids.map((id) => byId.get(id)).filter((d): d is Destination => !!d);
  }
}
