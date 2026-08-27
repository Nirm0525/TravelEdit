import { IMAGES } from './images';

export interface ExperienceCardPreview {
  image: string;
  alt: string;
  label: string;
}

export interface Experience {
  slug: string;
  name: string;
  icon: 'heart' | 'compass' | 'column' | 'lotus' | 'sparkle';
  image: string;
  alt: string;
  // Curadas a mano para el efecto de abanico al pasar el cursor por cada
  // pestaña — no vienen de site_content.experiencias (ese CMS solo edita
  // nombre/ícono/imagen única), así que un item cargado desde ahí
  // simplemente no las tiene y el componente cae de vuelta a la imagen
  // única de siempre.
  cards?: ExperienceCardPreview[];
}

export const EXPERIENCES: Experience[] = [
  {
    slug: 'romance',
    name: 'Romance',
    icon: 'heart',
    image: IMAGES.experienceRomance.url,
    alt: IMAGES.experienceRomance.alt,
    cards: [
      { image: IMAGES.experienceRomance.url, alt: IMAGES.experienceRomance.alt, label: 'Candlelit Dinners' },
      { image: IMAGES.destinationMaldives.url, alt: IMAGES.destinationMaldives.alt, label: 'Overwater Villas' },
      { image: IMAGES.destinationAmalfi.url, alt: IMAGES.destinationAmalfi.alt, label: 'Amalfi Coast' }
    ]
  },
  {
    slug: 'adventure',
    name: 'Adventure',
    icon: 'compass',
    image: IMAGES.experienceAdventure.url,
    alt: IMAGES.experienceAdventure.alt,
    cards: [
      { image: IMAGES.experienceAdventure.url, alt: IMAGES.experienceAdventure.alt, label: 'Mountain Trails' },
      { image: IMAGES.destinationPatagonia.url, alt: IMAGES.destinationPatagonia.alt, label: 'Patagonia' },
      { image: IMAGES.destinationSerengeti.url, alt: IMAGES.destinationSerengeti.alt, label: 'Serengeti Safari' }
    ]
  },
  {
    slug: 'culture',
    name: 'Culture',
    icon: 'column',
    image: IMAGES.experienceCulture.url,
    alt: IMAGES.experienceCulture.alt,
    cards: [
      { image: IMAGES.experienceCulture.url, alt: IMAGES.experienceCulture.alt, label: 'Ancient Rome' },
      { image: IMAGES.destinationKyoto.url, alt: IMAGES.destinationKyoto.alt, label: 'Bamboo Forests' },
      { image: IMAGES.destinationIstanbul.url, alt: IMAGES.destinationIstanbul.alt, label: 'Istanbul' }
    ]
  },
  {
    slug: 'wellness',
    name: 'Wellness',
    icon: 'lotus',
    image: IMAGES.experienceWellness.url,
    alt: IMAGES.experienceWellness.alt,
    cards: [
      { image: IMAGES.experienceWellness.url, alt: IMAGES.experienceWellness.alt, label: 'Infinity Pools' },
      { image: IMAGES.destinationIceland.url, alt: IMAGES.destinationIceland.alt, label: 'Icelandic Falls' },
      { image: IMAGES.articleBaliHiddenGems.url, alt: IMAGES.articleBaliHiddenGems.alt, label: 'Hidden Bali' }
    ]
  },
  {
    slug: 'celebrate',
    name: 'Celebrate',
    icon: 'sparkle',
    image: IMAGES.experienceCelebrate.url,
    alt: IMAGES.experienceCelebrate.alt,
    cards: [
      { image: IMAGES.experienceCelebrate.url, alt: IMAGES.experienceCelebrate.alt, label: 'Toast to Life' },
      { image: IMAGES.hero.url, alt: IMAGES.hero.alt, label: 'Positano Nights' },
      { image: IMAGES.destinationDolomites.url, alt: IMAGES.destinationDolomites.alt, label: 'Dolomite Sunsets' }
    ]
  }
];
