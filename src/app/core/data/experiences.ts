import { IMAGES } from './images';

export interface ExperienceCardPreview {
  image: string;
  alt: string;
  label: string;
  description: string;
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
      {
        image: IMAGES.experienceRomance.url,
        alt: IMAGES.experienceRomance.alt,
        label: 'Candlelit Dinners',
        description: 'Sunset tables set for two'
      },
      {
        image: IMAGES.destinationMaldives.url,
        alt: IMAGES.destinationMaldives.alt,
        label: 'Overwater Villas',
        description: 'Private plunge pools above the lagoon'
      },
      {
        image: IMAGES.destinationAmalfi.url,
        alt: IMAGES.destinationAmalfi.alt,
        label: 'Amalfi Coast',
        description: 'Cliffside towns made for wandering hand in hand'
      }
    ]
  },
  {
    slug: 'adventure',
    name: 'Adventure',
    icon: 'compass',
    image: IMAGES.experienceAdventure.url,
    alt: IMAGES.experienceAdventure.alt,
    cards: [
      {
        image: IMAGES.experienceAdventure.url,
        alt: IMAGES.experienceAdventure.alt,
        label: 'Mountain Trails',
        description: 'Switchbacks with views for days'
      },
      {
        image: IMAGES.destinationPatagonia.url,
        alt: IMAGES.destinationPatagonia.alt,
        label: 'Patagonia',
        description: 'Glacial lakes at the edge of the world'
      },
      {
        image: IMAGES.destinationSerengeti.url,
        alt: IMAGES.destinationSerengeti.alt,
        label: 'Serengeti Safari',
        description: 'Where the horizon moves with the herd'
      }
    ]
  },
  {
    slug: 'culture',
    name: 'Culture',
    icon: 'column',
    image: IMAGES.experienceCulture.url,
    alt: IMAGES.experienceCulture.alt,
    cards: [
      {
        image: IMAGES.experienceCulture.url,
        alt: IMAGES.experienceCulture.alt,
        label: 'Ancient Rome',
        description: 'Two thousand years, still standing'
      },
      {
        image: IMAGES.destinationKyoto.url,
        alt: IMAGES.destinationKyoto.alt,
        label: 'Bamboo Forests',
        description: "Kyoto's quietest, greenest cathedral"
      },
      {
        image: IMAGES.destinationIstanbul.url,
        alt: IMAGES.destinationIstanbul.alt,
        label: 'Istanbul',
        description: 'Where two continents share a skyline'
      }
    ]
  },
  {
    slug: 'wellness',
    name: 'Wellness',
    icon: 'lotus',
    image: IMAGES.experienceWellness.url,
    alt: IMAGES.experienceWellness.alt,
    cards: [
      {
        image: IMAGES.experienceWellness.url,
        alt: IMAGES.experienceWellness.alt,
        label: 'Infinity Pools',
        description: 'Ocean views, zero edges'
      },
      {
        image: IMAGES.destinationIceland.url,
        alt: IMAGES.destinationIceland.alt,
        label: 'Icelandic Falls',
        description: 'Cold air, warmer perspective'
      },
      {
        image: IMAGES.articleBaliHiddenGems.url,
        alt: IMAGES.articleBaliHiddenGems.alt,
        label: 'Hidden Bali',
        description: 'A waterfall no map quite finds'
      }
    ]
  },
  {
    slug: 'celebrate',
    name: 'Celebrate',
    icon: 'sparkle',
    image: IMAGES.experienceCelebrate.url,
    alt: IMAGES.experienceCelebrate.alt,
    cards: [
      {
        image: IMAGES.experienceCelebrate.url,
        alt: IMAGES.experienceCelebrate.alt,
        label: 'Toast to Life',
        description: 'Good wine, better company'
      },
      {
        image: IMAGES.hero.url,
        alt: IMAGES.hero.alt,
        label: 'Positano Nights',
        description: 'The blue hour, bottled'
      },
      {
        image: IMAGES.destinationDolomites.url,
        alt: IMAGES.destinationDolomites.alt,
        label: 'Dolomite Sunsets',
        description: 'Mountains that blush right on cue'
      }
    ]
  }
];
