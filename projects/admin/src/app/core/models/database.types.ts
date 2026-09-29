import { StaffRole } from './staff-role';
import { DestinationStatus, Season, TripType } from './destination-enums';
import { LeadEmailStatus, LeadOrigin, LeadStatus, ProposalEmailStatus } from './lead-enums';
import { ProposalStatus } from './proposal-enums';

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
          email_status: LeadEmailStatus;
          email_sent_at: string | null;
          email_error: string | null;
          proposal_subject: string | null;
          proposal_message: string | null;
          proposal_sent_at: string | null;
          proposal_sent_by: string | null;
          proposal_email_status: ProposalEmailStatus | null;
          proposal_email_error: string | null;
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
      site_settings: {
        Row: {
          id: string;
          key: string;
          value: unknown;
          description: string | null;
          updated_at: string;
          updated_by: string | null;
        };
        Insert: {
          key: string;
          value: unknown;
          description?: string | null;
        };
        Update: {
          value?: unknown;
          description?: string | null;
        };
        Relationships: [];
      };
      articles: {
        Row: {
          id: string;
          slug: string;
          title: string;
          author_id: string | null;
          author_name: string | null;
          excerpt: string;
          cover_storage_path: string | null;
          cover_alt_text: string | null;
          body: string;
          tags: string[];
          status: string;
          scheduled_at: string | null;
          published_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          slug: string;
          title: string;
          author_id?: string | null;
          author_name?: string | null;
          excerpt?: string;
          cover_storage_path?: string | null;
          cover_alt_text?: string | null;
          body?: string;
          tags?: string[];
          status?: string;
          scheduled_at?: string | null;
        };
        Update: {
          slug?: string;
          title?: string;
          author_id?: string | null;
          author_name?: string | null;
          excerpt?: string;
          cover_storage_path?: string | null;
          cover_alt_text?: string | null;
          body?: string;
          tags?: string[];
          status?: string;
          scheduled_at?: string | null;
          published_at?: string | null;
        };
        Relationships: [];
      };
      proposals: {
        Row: {
          id: string;
          public_token: string;
          lead_id: string | null;
          status: ProposalStatus;
          client_name: string;
          destination_text: string | null;
          start_date: string | null;
          end_date: string | null;
          travelers_count: number | null;
          advisor_id: string | null;
          currency: string;
          access_required: boolean;
          content: Record<string, unknown>;
          title: string | null;
          cover_image_path: string | null;
          pricing_subtotal: number;
          pricing_fees: number;
          pricing_total: number;
          terms_accepted: boolean;
          accepted_at: string | null;
          accepted_by_name: string | null;
          published_at: string | null;
          viewed_at: string | null;
          expires_at: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          lead_id?: string | null;
          client_name: string;
          destination_text?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          travelers_count?: number | null;
          advisor_id?: string | null;
          currency?: string;
          access_required?: boolean;
          content?: Record<string, unknown>;
          expires_at?: string | null;
          created_by?: string | null;
        };
        Update: {
          lead_id?: string | null;
          client_name?: string;
          destination_text?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          travelers_count?: number | null;
          advisor_id?: string | null;
          currency?: string;
          access_required?: boolean;
          content?: Record<string, unknown>;
          expires_at?: string | null;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      reorder_itinerary_days: {
        Args: { p_destination_id: string; p_ordered_ids: string[] };
        Returns: undefined;
      };
      publish_proposal: {
        Args: { p_id: string };
        Returns: undefined;
      };
      unpublish_proposal: {
        Args: { p_id: string };
        Returns: undefined;
      };
      set_proposal_access_code: {
        Args: { p_id: string; p_code: string };
        Returns: undefined;
      };
      generate_proposal_access_code: {
        Args: { p_id: string };
        Returns: string;
      };
      proposal_has_access_code: {
        Args: { p_id: string };
        Returns: boolean;
      };
    };
  };
}
