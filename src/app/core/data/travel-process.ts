export interface ProcessStep {
  number: string;
  title: string;
  text: string;
  icon: 'person' | 'curate' | 'plane';
}

export const TRAVEL_PROCESS_STEPS: ProcessStep[] = [
  {
    number: '01',
    title: 'We get to know you',
    text: 'Tell us how you love to travel. Your style, pace, interests and what matters most to you.',
    icon: 'person'
  },
  {
    number: '02',
    title: 'We create your Travel Edit',
    text: 'First, we design the journey. Then we curate the stays, experiences and details that bring it to life.',
    icon: 'curate'
  },
  {
    number: '03',
    title: 'You experience it',
    text: 'Everything thoughtfully arranged. You simply travel, experience and enjoy.',
    icon: 'plane'
  }
];
