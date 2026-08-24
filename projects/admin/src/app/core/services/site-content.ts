import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { HeroContent, toHeroContent } from '../models/site-content.model';

@Injectable({
  providedIn: 'root'
})
export class SiteContentService {
  private readonly supabase = inject(SupabaseService);

  async getHero(): Promise<HeroContent> {
    const { data, error } = await this.supabase.client
      .from('site_content')
      .select('*')
      .eq('section', 'hero')
      .single();

    if (error) {
      throw error;
    }
    return toHeroContent(data);
  }

  async updateHero(content: HeroContent): Promise<void> {
    const { error } = await this.supabase.client
      .from('site_content')
      .update({ data: content as unknown as Record<string, unknown> })
      .eq('section', 'hero');

    if (error) {
      throw error;
    }
  }
}
