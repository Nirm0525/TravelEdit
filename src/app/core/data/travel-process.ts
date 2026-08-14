export interface ProcessStep {
  number: string;
  title: string;
  text: string;
  icon: 'person' | 'curate' | 'plane';
}

export const TRAVEL_PROCESS_STEPS: ProcessStep[] = [
  {
    number: '01',
    title: 'Tell us who you are',
    text: 'Share your dreams, passions and travel style.',
    icon: 'person'
  },
  {
    number: '02',
    title: 'We curate',
    text: 'We design a bespoke journey just for you.',
    icon: 'curate'
  },
  {
    number: '03',
    title: 'You experience',
    text: 'Live every moment. We handle the rest.',
    icon: 'plane'
  }
];
