export const TRAVELING_WITH_OPTIONS = ['Couple', 'Family', 'Friends', 'Solo', 'Group'] as const;
export type TravelingWith = (typeof TRAVELING_WITH_OPTIONS)[number];

export const OCCASION_OPTIONS = [
  'Honeymoon',
  'Anniversary',
  'Birthday',
  'Family trip',
  'Just because',
  'Something else'
] as const;
export type Occasion = (typeof OCCASION_OPTIONS)[number];

export const STYLE_PREFERENCE_OPTIONS = [
  'Beautiful hotels',
  'Great food',
  'Culture & local experiences',
  'Nature & adventure',
  'Relaxation',
  'Beach',
  'Wellness',
  'Nightlife',
  'Shopping',
  'Privacy & exclusivity',
  'A little bit of everything'
] as const;
export type StylePreference = (typeof STYLE_PREFERENCE_OPTIONS)[number];

export const PACE_OPTIONS = [
  { value: 'Slow', description: 'Fewer places, more time to enjoy each one' },
  { value: 'Balanced', description: 'A little exploring, a little downtime' },
  { value: 'Active', description: 'I want to see and experience as much as possible' }
] as const;
export type Pace = (typeof PACE_OPTIONS)[number]['value'];

export const HOTEL_STYLE_OPTIONS = [
  'Boutique & full of character',
  'Classic luxury',
  'Modern & design-forward',
  'Resort',
  "I'm open to your recommendations"
] as const;
export type HotelStyle = (typeof HOTEL_STYLE_OPTIONS)[number];

export const BUDGET_RANGE_OPTIONS = [
  '$5,000–$7,500',
  '$7,500–$10,000',
  '$10,000–$15,000',
  '$15,000–$25,000',
  '$25,000+',
  "I'd like guidance"
] as const;
export type BudgetRange = (typeof BUDGET_RANGE_OPTIONS)[number];

export const FLIGHT_CLASS_OPTIONS = [
  'Economy',
  'Premium Economy',
  'Business',
  'First',
  'Depends on the flight'
] as const;
export type FlightClass = (typeof FLIGHT_CLASS_OPTIONS)[number];

export const HEAR_ABOUT_US_OPTIONS = ['Instagram', 'Friend or Referral', 'Google', 'Returning Client', 'Other'] as const;
export type HearAboutUs = (typeof HEAR_ABOUT_US_OPTIONS)[number];

export interface LeadTripDetails {
  location: string;
  travelingWith: TravelingWith | null;
  adults: number | null;
  children: number | null;
  childrenAges: string;
  destinationNotes: string;
  departureDate: string;
  returnDate: string;
  nights: number | null;
  datesFlexible: boolean;
  occasion: Occasion | null;
  stylePreferences: StylePreference[];
  pace: Pace | null;
  hotelStyle: HotelStyle | null;
  budgetRange: BudgetRange | null;
  flightClass: FlightClass | null;
  likesAndDislikes: string;
  unforgettableNote: string;
  hearAboutUs: HearAboutUs | null;
}
