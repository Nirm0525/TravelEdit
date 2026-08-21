// Espejo de src/app/core/models/lead-trip-details.ts del sitio público — son
// apps separadas (bundles distintos a propósito), así que se duplica en vez
// de compartir código entre proyectos por una sola interfaz.

export interface LeadTripDetails {
  location?: string;
  travelingWith?: string;
  adults?: number | null;
  children?: number | null;
  childrenAges?: string;
  destinationNotes?: string;
  departureDate?: string;
  returnDate?: string;
  nights?: number | null;
  datesFlexible?: boolean;
  occasion?: string;
  stylePreferences?: string[];
  pace?: string;
  hotelStyle?: string;
  budgetRange?: string;
  flightClass?: string;
  likesAndDislikes?: string;
  unforgettableNote?: string;
  hearAboutUs?: string;
}

export function toLeadTripDetails(value: unknown): LeadTripDetails {
  if (!value || typeof value !== 'object') {
    return {};
  }
  return value as LeadTripDetails;
}
