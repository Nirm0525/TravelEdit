import { DestinationStatus, Season, TripType } from './destination-enums';
import { Database } from './database.types';

type DestinationRow = Database['public']['Tables']['destinations']['Row'];
type ItineraryDayRow = Database['public']['Tables']['itinerary_days']['Row'];
type DestinationImageRow = Database['public']['Tables']['destination_images']['Row'];

export interface Destination {
  id: string;
  slug: string;
  title: string;
  countryRegion: string;
  tripType: TripType;
  durationDays: number;
  season: Season | null;
  priceRangeMin: number | null;
  priceRangeMax: number | null;
  shortDescription: string;
  longDescription: string;
  status: DestinationStatus;
  coverImageId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface ItineraryDay {
  id: string;
  destinationId: string;
  position: number;
  title: string;
  description: string;
  accommodation: string | null;
  includedExperiences: string[];
}

export interface DestinationImage {
  id: string;
  destinationId: string;
  storagePath: string;
  altText: string;
  position: number;
}

export function toDestination(row: DestinationRow): Destination {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    countryRegion: row.country_region,
    tripType: row.trip_type,
    durationDays: row.duration_days,
    season: row.season,
    priceRangeMin: row.price_range_min,
    priceRangeMax: row.price_range_max,
    shortDescription: row.short_description,
    longDescription: row.long_description,
    status: row.status,
    coverImageId: row.cover_image_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    publishedAt: row.published_at
  };
}

export function toItineraryDay(row: ItineraryDayRow): ItineraryDay {
  return {
    id: row.id,
    destinationId: row.destination_id,
    position: row.position,
    title: row.title,
    description: row.description,
    accommodation: row.accommodation,
    includedExperiences: row.included_experiences
  };
}

export function toDestinationImage(row: DestinationImageRow): DestinationImage {
  return {
    id: row.id,
    destinationId: row.destination_id,
    storagePath: row.storage_path,
    altText: row.alt_text,
    position: row.position
  };
}
