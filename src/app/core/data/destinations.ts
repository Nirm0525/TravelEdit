import { IMAGES } from './images';

export interface Destination {
  slug: string;
  name: string;
  country: string;
  image: string;
  alt: string;
}

export const DESTINATIONS: Destination[] = [
  { slug: 'amalfi-coast', name: 'Amalfi Coast', country: 'Italy', image: IMAGES.destinationAmalfi.url, alt: IMAGES.destinationAmalfi.alt },
  { slug: 'kyoto', name: 'Kyoto', country: 'Japan', image: IMAGES.destinationKyoto.url, alt: IMAGES.destinationKyoto.alt },
  { slug: 'maldives', name: 'Maldives', country: 'Maldives', image: IMAGES.destinationMaldives.url, alt: IMAGES.destinationMaldives.alt },
  { slug: 'serengeti', name: 'Serengeti', country: 'Tanzania', image: IMAGES.destinationSerengeti.url, alt: IMAGES.destinationSerengeti.alt },
  { slug: 'patagonia', name: 'Patagonia', country: 'Argentina', image: IMAGES.destinationPatagonia.url, alt: IMAGES.destinationPatagonia.alt },
  { slug: 'dolomites', name: 'Dolomites', country: 'Italy', image: IMAGES.destinationDolomites.url, alt: IMAGES.destinationDolomites.alt },
  { slug: 'iceland', name: 'Iceland', country: 'Iceland', image: IMAGES.destinationIceland.url, alt: IMAGES.destinationIceland.alt },
  { slug: 'istanbul', name: 'Istanbul', country: 'Turkey', image: IMAGES.destinationIstanbul.url, alt: IMAGES.destinationIstanbul.alt }
];
