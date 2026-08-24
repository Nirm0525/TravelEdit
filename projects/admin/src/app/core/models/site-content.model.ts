import { Database } from './database.types';

type SiteContentRow = Database['public']['Tables']['site_content']['Row'];

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

export function toHeroContent(row: SiteContentRow): HeroContent {
  const data = row.data as Partial<HeroContent>;
  return {
    eyebrow: data.eyebrow ?? '',
    titleLine1: data.titleLine1 ?? '',
    titleLine2: data.titleLine2 ?? '',
    titleLine3: data.titleLine3 ?? '',
    lead: data.lead ?? '',
    ctaLabel: data.ctaLabel ?? '',
    exploreLabel: data.exploreLabel ?? '',
    imageUrl: data.imageUrl ?? '',
    imageAlt: data.imageAlt ?? ''
  };
}
