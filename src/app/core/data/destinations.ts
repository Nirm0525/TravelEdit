import { IMAGES } from './images';

export interface Destination {
  slug: string;
  name: string;
  country: string;
  image: string;
  alt: string;
}

export const DESTINATIONS: Destination[] = [
  { slug: 'amalfi', name: 'Amalfi', country: 'Italy', image: IMAGES.destinationAmalfi.url, alt: IMAGES.destinationAmalfi.alt },
  { slug: 'paris', name: 'Paris', country: 'France', image: IMAGES.destinationParis.url, alt: IMAGES.destinationParis.alt },
  { slug: 'santorini', name: 'Santorini', country: 'Greece', image: IMAGES.destinationSantorini.url, alt: IMAGES.destinationSantorini.alt },
  { slug: 'bali', name: 'Bali', country: 'Indonesia', image: IMAGES.destinationBali.url, alt: IMAGES.destinationBali.alt },
  { slug: 'maldives', name: 'Maldives', country: 'Maldives', image: IMAGES.destinationMaldives.url, alt: IMAGES.destinationMaldives.alt }
];
