import { IMAGES } from './images';

export interface Article {
  category: string;
  title: string;
  excerpt: string;
  image: string;
  alt: string;
}

export const ARTICLES: Article[] = [
  {
    category: 'GUIDE',
    title: 'The Art of Slow Travel',
    excerpt: 'Why less is the new luxury.',
    image: IMAGES.articleSlowTravel.url,
    alt: IMAGES.articleSlowTravel.alt
  },
  {
    category: 'JOURNAL',
    title: 'A Weekend in Paris, Perfected',
    excerpt: "An insider's guide to timeless elegance.",
    image: IMAGES.articleParisWeekend.url,
    alt: IMAGES.articleParisWeekend.alt
  },
  {
    category: 'PLACES',
    title: 'Hidden Gems in Bali',
    excerpt: 'Beyond the map, into the magic.',
    image: IMAGES.articleBaliHiddenGems.url,
    alt: IMAGES.articleBaliHiddenGems.alt
  }
];
