import { Injectable, inject } from '@angular/core';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Lead, LeadNote, toLead, toLeadNote } from '../models/lead.model';
import { LeadEmailStatus, LeadOrigin, LeadStatus } from '../models/lead-enums';

export interface SendProposalResult {
  proposalSentAt: string;
  status: LeadStatus;
}

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

  /** `staffId` en null desasigna la solicitud. Cualquier miembro del staff
   *  puede asignarla a cualquier otro (no solo a sí mismo) — mismo permiso
   *  que ya cubre leads_update (can_manage_leads()). */
  async assignTo(id: string, staffId: string | null): Promise<Lead> {
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

  async sendProposal(leadId: string, subject: string, message: string): Promise<SendProposalResult> {
    const {
      data: { session },
      error: sessionError
    } = await this.supabase.client.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error('No hay una sesión autenticada. Vuelve a iniciar sesión.');
    }

    const { data, error } = await this.supabase.client.functions.invoke<
      SendProposalResult & { ok?: boolean; error?: string }
    >('send-proposal', {
      body: { leadId, subject, message },
      headers: { Authorization: `Bearer ${session.access_token}` }
    });

    if (error) {
      throw new Error(await this.extractServerMessage(error));
    }
    if (!data?.ok) {
      throw new Error(data?.error ?? 'No se pudo enviar la propuesta.');
    }

    return { proposalSentAt: data.proposalSentAt, status: data.status };
  }

  private async extractServerMessage(error: unknown): Promise<string> {
    if (error instanceof FunctionsFetchError) {
      console.error('send-proposal: fetch falló (red caída, función no desplegada, o bloqueo CORS del navegador).', error);
      return 'No se pudo conectar con el servidor. Revisa tu conexión e intenta de nuevo.';
    }
    if (error instanceof FunctionsRelayError) {
      console.error('send-proposal: error del relay de Supabase.', error);
      return 'Supabase tuvo un problema interno al invocar la función. Intenta de nuevo.';
    }
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) {
          return String(body.error);
        }
        return `La función respondió con un error (HTTP ${error.context.status}).`;
      } catch (parseErr) {
        console.error('send-proposal: no se pudo parsear el body del error.', parseErr);
        return `La función respondió con un error (HTTP ${error.context.status}).`;
      }
    }

    console.error('send-proposal: error inesperado.', error);
    return 'No se pudo conectar con el servidor. Intenta de nuevo.';
  }
}
