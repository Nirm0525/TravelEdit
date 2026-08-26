import { StaffRole } from './staff-role';
import { DestinationStatus, Season, TripType } from './destination-enums';
import { LeadOrigin, LeadStatus } from './lead-enums';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          full_name: string;
          role: StaffRole;
          created_at: string;
        };
        Insert: {
          id: string;
          full_name: string;
          role?: StaffRole;
        };
        Update: {
          full_name?: string;
          role?: StaffRole;
        };
        Relationships: [];
      };
      destinations: {
        Row: {
          id: string;
          slug: string;
          title: string;
          country_region: string;
          trip_type: TripType;
          duration_days: number;
          season: Season | null;
          price_range_min: number | null;
          price_range_max: number | null;
          short_description: string;
          long_description: string;
          status: DestinationStatus;
          cover_image_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          published_at: string | null;
        };
        Insert: {
          slug: string;
          title: string;
          country_region?: string;
          trip_type?: TripType;
          duration_days?: number;
          season?: Season | null;
          price_range_min?: number | null;
          price_range_max?: number | null;
          short_description?: string;
          // NOT NULL sin default en la base real (confirmado en Fase 4) —
          // el tipo generado asumía que había default, como describe la
          // migración 0002, pero esa columna nunca lo tuvo en producción.
          long_description?: string;
          status?: DestinationStatus;
          created_by?: string | null;
        };
        Update: {
          slug?: string;
          title?: string;
          country_region?: string;
          trip_type?: TripType;
          duration_days?: number;
          season?: Season | null;
          price_range_min?: number | null;
          price_range_max?: number | null;
          short_description?: string;
          status?: DestinationStatus;
          cover_image_id?: string | null;
          published_at?: string | null;
        };
        Relationships: [];
      };
      itinerary_days: {
        Row: {
          id: string;
          destination_id: string;
          position: number;
          title: string;
          description: string;
          accommodation: string | null;
          included_experiences: string[];
        };
        Insert: {
          destination_id: string;
          position: number;
          title?: string;
          description?: string;
          accommodation?: string | null;
          included_experiences?: string[];
        };
        Update: {
          title?: string;
          description?: string;
          accommodation?: string | null;
          included_experiences?: string[];
        };
        Relationships: [];
      };
      destination_images: {
        Row: {
          id: string;
          destination_id: string;
          storage_path: string;
          alt_text: string;
          position: number;
          created_at: string;
        };
        Insert: {
          destination_id: string;
          storage_path: string;
          alt_text: string;
          position: number;
        };
        Update: {
          alt_text?: string;
          position?: number;
        };
        Relationships: [];
      };
      leads: {
        Row: {
          id: string;
          name: string;
          email: string;
          phone: string | null;
          destination_interest_id: string | null;
          destination_interest_text: string | null;
          origin: LeadOrigin;
          message: string | null;
          details: Record<string, unknown>;
          status: LeadStatus;
          assigned_to: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          name: string;
          email: string;
          phone?: string | null;
          destination_interest_id?: string | null;
          destination_interest_text?: string | null;
          message?: string | null;
        };
        Update: {
          status?: LeadStatus;
          assigned_to?: string | null;
        };
        Relationships: [];
      };
      lead_notes: {
        Row: {
          id: string;
          lead_id: string;
          author_id: string;
          body: string;
          created_at: string;
        };
        Insert: {
          lead_id: string;
          author_id: string;
          body: string;
        };
        Update: {
          body?: string;
        };
        Relationships: [];
      };
      site_content: {
        Row: {
          id: string;
          section_key: string;
          content: Record<string, unknown>;
          updated_by: string | null;
          updated_at: string;
        };
        Insert: {
          section_key: string;
          content?: Record<string, unknown>;
          updated_by?: string | null;
        };
        Update: {
          content?: Record<string, unknown>;
          updated_by?: string | null;
        };
        Relationships: [];
      };
      audit_log: {
        Row: {
          id: string;
          actor_id: string | null;
          action: string;
          entity_type: string;
          entity_id: string | null;
          summary: string;
          created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reorder_itinerary_days: {
        Args: { p_destination_id: string; p_ordered_ids: string[] };
        Returns: undefined;
      };
    };
  };
}
