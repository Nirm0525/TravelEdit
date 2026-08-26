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

export interface DestinosDestacadosContent {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  headingLine3: string;
  support: string;
  destinationIds: string[];
}

export interface TravelProcessStep {
  number: string;
  title: string;
  text: string;
  icon: 'person' | 'curate' | 'plane';
}

export interface TravelProcessContent {
  titleLine1: string;
  titleLine2: string;
  steps: TravelProcessStep[];
}

export interface ExperienceItem {
  slug: string;
  name: string;
  icon: 'heart' | 'compass' | 'column' | 'lotus' | 'sparkle';
  image: string;
  alt: string;
}

export interface ExperienciasContent {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  support: string;
  items: ExperienceItem[];
}

export interface EditArticle {
  slug: string;
  category: string;
  title: string;
  excerpt: string;
  author: string;
  image: string;
  alt: string;
  body: string;
}

export interface TheEditContent {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  supportLine1: string;
  supportLine2: string;
  ctaLabel: string;
  ctaHref: string;
  articles: EditArticle[];
}

export interface AboutContent {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  paragraph1: string;
  paragraph2: string;
  paragraph3: string;
  words: string[];
  imageUrl: string;
  imageAlt: string;
}

export interface CtaFinalLink {
  label: string;
  href: string;
}

export interface CtaFinalContent {
  eyebrow: string;
  titleLine1: string;
  titleLine2: string;
  text: string;
  ctaLabel: string;
  imageUrl: string;
  imageAlt: string;
  links: CtaFinalLink[];
}

export interface FooterLink {
  label: string;
  href: string;
}

export interface FooterSocialLink {
  platform: string;
  label: string;
  href: string;
}

export interface FooterContent {
  exploreHeading: string;
  explore: FooterLink[];
  companyHeading: string;
  company: FooterLink[];
  followHeading: string;
  social: FooterSocialLink[];
  newsletterHeading: string;
  copyrightText: string;
}

export interface CustomSection {
  id: string;
  eyebrow: string;
  title: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
}

export interface CustomSectionsContent {
  sections: CustomSection[];
}

@Injectable({
  providedIn: 'root'
})
export class SiteContentService {
  private readonly supabase = inject(SupabaseService);

  async getHero(): Promise<Partial<HeroContent> | null> {
    return this.getSection<HeroContent>('hero');
  }

  async getDestinosDestacados(): Promise<Partial<DestinosDestacadosContent> | null> {
    return this.getSection<DestinosDestacadosContent>('destinos_destacados');
  }

  async getTravelProcess(): Promise<Partial<TravelProcessContent> | null> {
    return this.getSection<TravelProcessContent>('travel_process');
  }

  async getExperiencias(): Promise<Partial<ExperienciasContent> | null> {
    return this.getSection<ExperienciasContent>('experiencias');
  }

  async getTheEdit(): Promise<Partial<TheEditContent> | null> {
    return this.getSection<TheEditContent>('the_edit');
  }

  async getAbout(): Promise<Partial<AboutContent> | null> {
    return this.getSection<AboutContent>('about');
  }

  async getCtaFinal(): Promise<Partial<CtaFinalContent> | null> {
    return this.getSection<CtaFinalContent>('cta_final');
  }

  async getFooter(): Promise<Partial<FooterContent> | null> {
    return this.getSection<FooterContent>('footer');
  }

  async getCustomSections(): Promise<Partial<CustomSectionsContent> | null> {
    return this.getSection<CustomSectionsContent>('custom_sections');
  }

  private async getSection<T>(sectionKey: string): Promise<Partial<T> | null> {
    const { data, error } = await this.supabase.client
      .from('site_content')
      .select('content')
      .eq('section_key', sectionKey)
      .maybeSingle();

    if (error || !data) {
      return null;
    }
    return data.content as Partial<T>;
  }
}
