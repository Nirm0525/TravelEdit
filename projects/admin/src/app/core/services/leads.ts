import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Lead, LeadNote, toLead, toLeadNote } from '../models/lead.model';
import { LeadOrigin, LeadStatus } from '../models/lead-enums';

export interface LeadListPage {
  items: Lead[];
  total: number;
}

export interface LeadListParams {
  page: number;
  pageSize: number;
  status?: LeadStatus;
  origin?: LeadOrigin;
  destinationSearch?: string;
  createdFrom?: string;
  createdTo?: string;
}

@Injectable({
  providedIn: 'root'
})
export class LeadsService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async list(params: LeadListParams): Promise<LeadListPage> {
    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    let query = this.supabase.client
      .from('leads')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.origin) {
      query = query.eq('origin', params.origin);
    }
    if (params.destinationSearch) {
      query = query.ilike('destination_interest_text', `%${params.destinationSearch}%`);
    }
    if (params.createdFrom) {
      query = query.gte('created_at', params.createdFrom);
    }
    if (params.createdTo) {
      query = query.lte('created_at', params.createdTo);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    return { items: (data ?? []).map(toLead), total: count ?? 0 };
  }

  /** Sin paginación, hasta 2000 filas — para exportar exactamente lo que ve el filtro activo. */
  async listForExport(params: Omit<LeadListParams, 'page' | 'pageSize'>): Promise<Lead[]> {
    let query = this.supabase.client
      .from('leads')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(2000);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.origin) {
      query = query.eq('origin', params.origin);
    }
    if (params.destinationSearch) {
      query = query.ilike('destination_interest_text', `%${params.destinationSearch}%`);
    }
    if (params.createdFrom) {
      query = query.gte('created_at', params.createdFrom);
    }
    if (params.createdTo) {
      query = query.lte('created_at', params.createdTo);
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(toLead);
  }

  async getById(id: string): Promise<Lead | null> {
    const { data, error } = await this.supabase.client.from('leads').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toLead(data) : null;
  }

  async updateStatus(id: string, status: LeadStatus): Promise<Lead> {
    const { data, error } = await this.supabase.client
      .from('leads')
      .update({ status })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toLead(data);
  }

  async assignToMe(id: string): Promise<Lead> {
    const staffId = this.auth.profile()?.id;
    if (!staffId) {
      throw new Error('Sin sesión.');
    }

    const { data, error } = await this.supabase.client
      .from('leads')
      .update({ assigned_to: staffId })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toLead(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('leads').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async listNotes(leadId: string): Promise<LeadNote[]> {
    const { data, error } = await this.supabase.client
      .from('lead_notes')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }
    return (data ?? []).map(toLeadNote);
  }

  async addNote(leadId: string, body: string): Promise<LeadNote> {
    const authorId = this.auth.profile()?.id;
    if (!authorId) {
      throw new Error('Sin sesión.');
    }

    const { data, error } = await this.supabase.client
      .from('lead_notes')
      .insert({ lead_id: leadId, author_id: authorId, body })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toLeadNote(data);
  }
}
