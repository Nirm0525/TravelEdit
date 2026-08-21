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
    category: 'THE EDIT',
    title: 'The Art of Slow Travel',
    excerpt: 'Why seeing less can mean experiencing more.',
    image: IMAGES.articleSlowTravel.url,
    alt: IMAGES.articleSlowTravel.alt
  },
  {
    category: 'PLACES',
    title: 'Italy, Beyond the Obvious',
    excerpt: "The places we'd return to—and how we'd experience them.",
    image: IMAGES.articleItaly.url,
    alt: IMAGES.articleItaly.alt
  },
  {
    category: 'JOURNAL',
    title: 'Where to Go Next',
    excerpt: 'Five destinations worth having on your radar.',
    image: IMAGES.articleBaliHiddenGems.url,
    alt: IMAGES.articleBaliHiddenGems.alt
  }
];
