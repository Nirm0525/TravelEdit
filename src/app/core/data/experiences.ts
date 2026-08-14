import { IMAGES } from './images';

export interface Experience {
  slug: string;
  name: string;
  icon: 'heart' | 'compass' | 'column' | 'lotus' | 'sparkle';
  image: string;
  alt: string;
}

export const EXPERIENCES: Experience[] = [
  { slug: 'romance', name: 'Romance', icon: 'heart', image: IMAGES.experienceRomance.url, alt: IMAGES.experienceRomance.alt },
  { slug: 'adventure', name: 'Adventure', icon: 'compass', image: IMAGES.experienceAdventure.url, alt: IMAGES.experienceAdventure.alt },
  { slug: 'culture', name: 'Culture', icon: 'column', image: IMAGES.experienceCulture.url, alt: IMAGES.experienceCulture.alt },
  { slug: 'wellness', name: 'Wellness', icon: 'lotus', image: IMAGES.experienceWellness.url, alt: IMAGES.experienceWellness.alt },
  { slug: 'celebrate', name: 'Celebrate', icon: 'sparkle', image: IMAGES.experienceCelebrate.url, alt: IMAGES.experienceCelebrate.alt }
];
