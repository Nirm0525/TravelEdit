import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Lead, LeadNote, toLead, toLeadNote } from '../models/lead.model';
import { LeadEmailStatus, LeadOrigin, LeadStatus } from '../models/lead-enums';

export interface LeadListPage {
  items: Lead[];
  total: number;
}

export interface LeadListParams {
  page: number;
  pageSize: number;
  status?: LeadStatus;
  origin?: LeadOrigin;
  emailStatus?: LeadEmailStatus;
  search?: string;
  createdFrom?: string;
  createdTo?: string;
}

export interface LeadStats {
  total: number;
  nuevas: number;
  enSeguimiento: number;
  cerradas: number;
  emailSent: number;
  emailPending: number;
  emailPartial: number;
  emailFailed: number;
  emailNotConfigured: number;
}

/** El buscador combinado usa `.or()` de PostgREST — comas y paréntesis rompen esa sintaxis. */
function escapeSearchTerm(term: string): string {
  return term.replace(/[,()%]/g, ' ').trim();
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
    if (params.emailStatus) {
      query = query.eq('email_status', params.emailStatus);
    }
    if (params.search) {
      const term = escapeSearchTerm(params.search);
      if (term) {
        query = query.or(
          `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,destination_interest_text.ilike.%${term}%`
        );
      }
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
    if (params.emailStatus) {
      query = query.eq('email_status', params.emailStatus);
    }
    if (params.search) {
      const term = escapeSearchTerm(params.search);
      if (term) {
        query = query.or(
          `name.ilike.%${term}%,email.ilike.%${term}%,phone.ilike.%${term}%,destination_interest_text.ilike.%${term}%`
        );
      }
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

  /** Conteos globales para las tarjetas de resumen del listado — no dependen de los filtros activos. */
  async getStats(): Promise<LeadStats> {
    const base = () => this.supabase.client.from('leads').select('*', { count: 'exact', head: true });

    const [
      totalRes,
      nuevaRes,
      contactadaRes,
      propuestaRes,
      ganadaRes,
      perdidaRes,
      sentRes,
      pendingRes,
      partialRes,
      failedRes,
      notConfiguredRes
    ] = await Promise.all([
      base(),
      base().eq('status', 'nueva'),
      base().eq('status', 'contactada'),
      base().eq('status', 'propuesta_enviada'),
      base().eq('status', 'cerrada_ganada'),
      base().eq('status', 'cerrada_perdida'),
      base().eq('email_status', 'sent'),
      base().eq('email_status', 'pending'),
      base().eq('email_status', 'partial'),
      base().eq('email_status', 'failed'),
      base().eq('email_status', 'not_configured')
    ]);

    const results = [
      totalRes,
      nuevaRes,
      contactadaRes,
      propuestaRes,
      ganadaRes,
      perdidaRes,
      sentRes,
      pendingRes,
      partialRes,
      failedRes,
      notConfiguredRes
    ];
    for (const result of results) {
      if (result.error) {
        throw result.error;
      }
    }

    return {
      total: totalRes.count ?? 0,
      nuevas: nuevaRes.count ?? 0,
      enSeguimiento: (contactadaRes.count ?? 0) + (propuestaRes.count ?? 0),
      cerradas: (ganadaRes.count ?? 0) + (perdidaRes.count ?? 0),
      emailSent: sentRes.count ?? 0,
      emailPending: pendingRes.count ?? 0,
      emailPartial: partialRes.count ?? 0,
      emailFailed: failedRes.count ?? 0,
      emailNotConfigured: notConfiguredRes.count ?? 0
    };
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
