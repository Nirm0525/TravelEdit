import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

export interface HeroContent {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  titleLine3: string;
  lead: string;
  ctaLabel: string;
  exploreLabel: string;
  imageUrl: string;
  imageAlt: string;
}

@Injectable({
  providedIn: 'root'
})
export class SiteContentService {
  private readonly supabase = inject(SupabaseService);

  async getHero(): Promise<Partial<HeroContent> | null> {
    const { data, error } = await this.supabase.client
      .from('site_content')
      .select('content')
      .eq('section_key', 'hero')
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    return data.content as Partial<HeroContent>;
  }
}
