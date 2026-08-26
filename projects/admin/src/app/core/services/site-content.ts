import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import {
  AboutContent,
  CtaFinalContent,
  CustomSectionsContent,
  DestinosDestacadosContent,
  ExperienciasContent,
  FooterContent,
  HeroContent,
  TheEditContent,
  TravelProcessContent,
  toAboutContent,
  toCtaFinalContent,
  toCustomSectionsContent,
  toDestinosDestacadosContent,
  toExperienciasContent,
  toFooterContent,
  toHeroContent,
  toTheEditContent,
  toTravelProcessContent
} from '../models/site-content.model';

export interface SiteContentMeta {
  sectionKey: string;
  updatedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class SiteContentService {
  private readonly supabase = inject(SupabaseService);

  async getHero(): Promise<HeroContent> {
    return toHeroContent(await this.getRow('hero'));
  }

  async updateHero(content: HeroContent): Promise<void> {
    await this.updateRow('hero', content);
  }

  async getDestinosDestacados(): Promise<DestinosDestacadosContent> {
    return toDestinosDestacadosContent(await this.getRow('destinos_destacados'));
  }

  async updateDestinosDestacados(content: DestinosDestacadosContent): Promise<void> {
    await this.updateRow('destinos_destacados', content);
  }

  async getTravelProcess(): Promise<TravelProcessContent> {
    return toTravelProcessContent(await this.getRow('travel_process'));
  }

  async updateTravelProcess(content: TravelProcessContent): Promise<void> {
    await this.updateRow('travel_process', content);
  }

  async getExperiencias(): Promise<ExperienciasContent> {
    return toExperienciasContent(await this.getRow('experiencias'));
  }

  async updateExperiencias(content: ExperienciasContent): Promise<void> {
    await this.updateRow('experiencias', content);
  }

  async getTheEdit(): Promise<TheEditContent> {
    return toTheEditContent(await this.getRow('the_edit'));
  }

  async updateTheEdit(content: TheEditContent): Promise<void> {
    await this.updateRow('the_edit', content);
  }

  async getAbout(): Promise<AboutContent> {
    return toAboutContent(await this.getRow('about'));
  }

  async updateAbout(content: AboutContent): Promise<void> {
    await this.updateRow('about', content);
  }

  async getCtaFinal(): Promise<CtaFinalContent> {
    return toCtaFinalContent(await this.getRow('cta_final'));
  }

  async updateCtaFinal(content: CtaFinalContent): Promise<void> {
    await this.updateRow('cta_final', content);
  }

  async getFooter(): Promise<FooterContent> {
    return toFooterContent(await this.getRow('footer'));
  }

  async updateFooter(content: FooterContent): Promise<void> {
    await this.updateRow('footer', content);
  }

  async getCustomSections(): Promise<CustomSectionsContent> {
    return toCustomSectionsContent(await this.getRow('custom_sections'));
  }

  async updateCustomSections(content: CustomSectionsContent): Promise<void> {
    await this.updateRow('custom_sections', content);
  }

  /** Metadata liviana de todas las secciones, para la pantalla de overview — sin traer el jsonb completo. */
  async listMeta(): Promise<SiteContentMeta[]> {
    const { data, error } = await this.supabase.client.from('site_content').select('section_key, updated_at');

    if (error) {
      throw error;
    }
    return (data ?? []).map((row) => ({ sectionKey: row.section_key, updatedAt: row.updated_at }));
  }

  private async getRow(sectionKey: string) {
    const { data, error } = await this.supabase.client
      .from('site_content')
      .select('*')
      .eq('section_key', sectionKey)
      .single();

    if (error) {
      throw error;
    }
    return data;
  }

  private async updateRow(sectionKey: string, content: unknown): Promise<void> {
    const { error } = await this.supabase.client
      .from('site_content')
      .update({ content: content as Record<string, unknown> })
      .eq('section_key', sectionKey);

    if (error) {
      throw error;
    }
  }
}
