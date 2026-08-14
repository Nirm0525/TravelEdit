import { IMAGES } from './images';

export interface NavItem {
  label: string;
  href: string;
  image: string;
  alt: string;
}

export const NAV_ITEMS: NavItem[] = [
  { label: 'Destinos', href: '#destinos', image: IMAGES.destinationAmalfi.url, alt: IMAGES.destinationAmalfi.alt },
  { label: 'Experiencias', href: '#experiencias', image: IMAGES.experienceRomance.url, alt: IMAGES.experienceRomance.alt },
  { label: 'The Edit', href: '#the-edit', image: IMAGES.articleSlowTravel.url, alt: IMAGES.articleSlowTravel.alt },
  { label: 'About Us', href: '#about', image: IMAGES.about.url, alt: IMAGES.about.alt }
];
