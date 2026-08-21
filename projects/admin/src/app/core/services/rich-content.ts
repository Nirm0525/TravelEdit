import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

export type RichContentTable = 'destinations' | 'articles';

@Injectable({
  providedIn: 'root'
})
export class RichContentService {
  private readonly supabase = inject(SupabaseService);

  /** long_description / body no se pueden UPDATE directo (ver 0002_destinations.sql):
   *  pasan por la Edge Function save-rich-content, que sanea con una librería real
   *  antes de escribir con la service role. */
  async save(table: RichContentTable, id: string, html: string): Promise<string> {
    const { data, error } = await this.supabase.client.functions.invoke<{ ok: boolean; html: string }>(
      'save-rich-content',
      { body: { table, id, html } }
    );

    if (error || !data) {
      throw new Error('No se pudo guardar la descripción larga.');
    }

    return data.html;
  }
}
