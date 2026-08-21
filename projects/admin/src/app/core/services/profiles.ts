import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

@Injectable({
  providedIn: 'root'
})
export class ProfilesService {
  private readonly supabase = inject(SupabaseService);
  private cache: Promise<Map<string, string>> | null = null;

  /** El equipo son 2-5 personas: cachear el mapa completo id->nombre es más
   *  simple que resolver nombres uno por uno por cada nota/lead. */
  nameMap(): Promise<Map<string, string>> {
    if (!this.cache) {
      this.cache = this.fetchNameMap();
    }
    return this.cache;
  }

  private async fetchNameMap(): Promise<Map<string, string>> {
    const { data, error } = await this.supabase.client.from('profiles').select('id, full_name');
    if (error) {
      throw error;
    }
    return new Map((data ?? []).map((row) => [row.id, row.full_name]));
  }
}
