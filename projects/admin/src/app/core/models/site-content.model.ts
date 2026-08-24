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

// Mismo contenido que hoy está en vivo en el sitio público (fallback hardcodeado
// en src/app/features/hero/hero.ts) — se usa aquí para que el editor arranque
// mostrando lo que realmente ve un visitante hoy, incluso si la fila en
// site_content todavía no tiene guardado alguno de estos campos.
const HERO_LIVE_DEFAULT: HeroContent = {
  eyebrow: 'Bespoke Travel Experiences',
  titleLine1: 'Because',
  titleLine2: 'luxury',
  titleLine3: 'is personal.',
  lead: 'Viajes diseñados a tu manera.\nCuidando cada detalle para que cada experiencia. Se sienta realmente tuya.',
  ctaLabel: 'DISEÑA TU VIAJE',
  exploreLabel: 'EXPLORE',
  imageUrl: 'https://images.unsplash.com/photo-1583844056361-4418a8f2a985?q=80&w=2400&h=1350&fit=crop&auto=format',
  imageAlt:
    'Vista panorámica de Positano en la Costa Amalfitana durante la hora azul, con el pueblo iluminado sobre el mar Tirreno'
};

export function toHeroContent(row: SiteContentRow): HeroContent {
  const data = row.content as Partial<HeroContent>;
  return {
    eyebrow: data.eyebrow ?? HERO_LIVE_DEFAULT.eyebrow,
    titleLine1: data.titleLine1 ?? HERO_LIVE_DEFAULT.titleLine1,
    titleLine2: data.titleLine2 ?? HERO_LIVE_DEFAULT.titleLine2,
    titleLine3: data.titleLine3 ?? HERO_LIVE_DEFAULT.titleLine3,
    lead: data.lead ?? HERO_LIVE_DEFAULT.lead,
    ctaLabel: data.ctaLabel ?? HERO_LIVE_DEFAULT.ctaLabel,
    exploreLabel: data.exploreLabel ?? HERO_LIVE_DEFAULT.exploreLabel,
    imageUrl: data.imageUrl ?? HERO_LIVE_DEFAULT.imageUrl,
    imageAlt: data.imageAlt ?? HERO_LIVE_DEFAULT.imageAlt
  };
}
