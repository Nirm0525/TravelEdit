import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import {
  Destination,
  ItineraryDay,
  toDestination,
  toItineraryDay
} from '../models/destination.model';
import { DestinationStatus } from '../models/destination-enums';
import { slugify } from '../utils/slugify';

export interface DestinationListPage {
  items: Destination[];
  total: number;
}

export interface DestinationListParams {
  page: number;
  pageSize: number;
  status?: DestinationStatus;
  search?: string;
}

@Injectable({
  providedIn: 'root'
})
export class DestinationsService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async list(params: DestinationListParams): Promise<DestinationListPage> {
    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    let query = this.supabase.client
      .from('destinations')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.search) {
      query = query.ilike('title', `%${params.search}%`);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    return {
      items: (data ?? []).map(toDestination),
      total: count ?? 0
    };
  }

  async getById(id: string): Promise<Destination | null> {
    const { data, error } = await this.supabase.client
      .from('destinations')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data ? toDestination(data) : null;
  }

  async createDraft(title: string): Promise<Destination> {
    const baseSlug = slugify(title) || `destino-${crypto.randomUUID().slice(0, 8)}`;

    const { data, error } = await this.supabase.client
      .from('destinations')
      .insert({
        title,
        slug: baseSlug,
        created_by: this.auth.profile()?.id
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toDestination(data);
  }

  async update(
    id: string,
    patch: {
      title?: string;
      slug?: string;
      countryRegion?: string;
      tripType?: Destination['tripType'];
      durationDays?: number;
      season?: Destination['season'];
      priceRangeMin?: number | null;
      priceRangeMax?: number | null;
      shortDescription?: string;
    }
  ): Promise<Destination> {
    const { data, error } = await this.supabase.client
      .from('destinations')
      .update({
        title: patch.title,
        slug: patch.slug,
        country_region: patch.countryRegion,
        trip_type: patch.tripType,
        duration_days: patch.durationDays,
        season: patch.season,
        price_range_min: patch.priceRangeMin,
        price_range_max: patch.priceRangeMax,
        short_description: patch.shortDescription
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toDestination(data);
  }

  async updateStatus(id: string, status: DestinationStatus): Promise<Destination> {
    const patch: { status: DestinationStatus; published_at?: string } = { status };
    if (status === 'published') {
      patch.published_at = new Date().toISOString();
    }

    const { data, error } = await this.supabase.client
      .from('destinations')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toDestination(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('destinations').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async listItineraryDays(destinationId: string): Promise<ItineraryDay[]> {
    const { data, error } = await this.supabase.client
      .from('itinerary_days')
      .select('*')
      .eq('destination_id', destinationId)
      .order('position', { ascending: true });

    if (error) {
      throw error;
    }
    return (data ?? []).map(toItineraryDay);
  }

  async addItineraryDay(destinationId: string, nextPosition: number): Promise<ItineraryDay> {
    const { data, error } = await this.supabase.client
      .from('itinerary_days')
      .insert({
        destination_id: destinationId,
        position: nextPosition,
        title: `Día ${nextPosition + 1}`,
        description: ''
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toItineraryDay(data);
  }

  async updateItineraryDay(
    id: string,
    patch: { title?: string; description?: string; accommodation?: string | null; includedExperiences?: string[] }
  ): Promise<ItineraryDay> {
    const { data, error } = await this.supabase.client
      .from('itinerary_days')
      .update({
        title: patch.title,
        description: patch.description,
        accommodation: patch.accommodation,
        included_experiences: patch.includedExperiences
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toItineraryDay(data);
  }

  async removeItineraryDay(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('itinerary_days').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  /** Única forma segura de reordenar: una llamada, una transacción real en el servidor. */
  async reorderItineraryDays(destinationId: string, orderedIds: string[]): Promise<void> {
    const { error } = await this.supabase.client.rpc('reorder_itinerary_days', {
      p_destination_id: destinationId,
      p_ordered_ids: orderedIds
    });

    if (error) {
      throw error;
    }
  }
}
