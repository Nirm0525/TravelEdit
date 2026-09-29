import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { Proposal, ProposalContent, toProposal } from '../models/proposal.model';
import { ProposalStatus } from '../models/proposal-enums';

export interface ProposalListPage {
  items: Proposal[];
  total: number;
}

export interface ProposalListParams {
  page: number;
  pageSize: number;
  status?: ProposalStatus;
  search?: string;
}

export interface CreateProposalPayload {
  clientName: string;
  leadId?: string;
  destinationText?: string;
  /** Solo se pasan cuando vienen de datos reales y estructurados (ej. el
   *  prellenado desde una solicitud) — nunca inventados en el momento de
   *  crear el draft. */
  travelersCount?: number;
  startDate?: string;
  endDate?: string;
}

export interface UpdateProposalPayload {
  clientName?: string;
  destinationText?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelersCount?: number | null;
  advisorId?: string | null;
  currency?: string;
  accessRequired?: boolean;
  expiresAt?: string | null;
}

/** Publish/unpublish/set-access-code son RPC — nunca un UPDATE directo de
 *  `status`/código, para que la validación de "está listo para publicar" y
 *  el hasheo del código sigan viviendo únicamente en Supabase (ver
 *  supabase/migrations/0032_proposals_admin_rpc.sql y 0035). Un error de RPC
 *  se relanza tal cual: `error.message` ya trae el texto exacto que arma el
 *  backend (p. ej. "Faltan datos para publicar: ..."), y ese es el mensaje
 *  que debe llegar a la UI — Angular no reimplementa esa validación. */
@Injectable({
  providedIn: 'root'
})
export class ProposalsService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  async list(params: ProposalListParams): Promise<ProposalListPage> {
    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    let query = this.supabase.client
      .from('proposals')
      .select('*', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.search) {
      const term = `%${params.search}%`;
      query = query.or(`client_name.ilike.${term},destination_text.ilike.${term}`);
    }

    const { data, count, error } = await query;
    if (error) {
      throw error;
    }

    return {
      items: (data ?? []).map(toProposal),
      total: count ?? 0
    };
  }

  async getById(id: string): Promise<Proposal | null> {
    const { data, error } = await this.supabase.client.from('proposals').select('*').eq('id', id).maybeSingle();
    if (error) {
      throw error;
    }
    return data ? toProposal(data) : null;
  }

  async createDraft(payload: CreateProposalPayload): Promise<Proposal> {
    const { data, error } = await this.supabase.client
      .from('proposals')
      .insert({
        client_name: payload.clientName,
        lead_id: payload.leadId ?? null,
        destination_text: payload.destinationText ?? null,
        travelers_count: payload.travelersCount ?? null,
        start_date: payload.startDate ?? null,
        end_date: payload.endDate ?? null,
        created_by: this.auth.profile()?.id
      })
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toProposal(data);
  }

  /** Un lead puede tener más de una propuesta con el tiempo (no hay UNIQUE en
   *  `proposals.lead_id`, y no se audita imponer uno en esta fase) — el CTA
   *  de la solicitud usa la más recientemente actualizada como "la propuesta
   *  vigente" para ese lead, para no crear duplicados ni tener que agregar
   *  un estado nuevo de "propuesta activa". */
  async findByLeadId(leadId: string): Promise<Proposal | null> {
    const { data, error } = await this.supabase.client
      .from('proposals')
      .select('*')
      .eq('lead_id', leadId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }
    return data ? toProposal(data) : null;
  }

  async update(id: string, patch: UpdateProposalPayload): Promise<Proposal> {
    const { data, error } = await this.supabase.client
      .from('proposals')
      .update({
        client_name: patch.clientName,
        destination_text: patch.destinationText,
        start_date: patch.startDate,
        end_date: patch.endDate,
        travelers_count: patch.travelersCount,
        advisor_id: patch.advisorId,
        currency: patch.currency,
        access_required: patch.accessRequired,
        expires_at: patch.expiresAt
      })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toProposal(data);
  }

  /** `content` es la única fuente de verdad del cover/intro/días/servicios/
   *  pricing/términos — se guarda entero en cada save (mismo criterio que
   *  site_content.content y leads.details: un solo campo jsonb, sin PATCH
   *  parcial del lado del servidor). pricing_subtotal/fees/total y
   *  title/cover_image_path vuelven recalculados por Supabase en la
   *  respuesta — son de solo lectura, nunca se leen del `content` que se
   *  manda, siempre del row que Supabase devuelve después del UPDATE. */
  async updateContent(id: string, content: ProposalContent): Promise<Proposal> {
    const { data, error } = await this.supabase.client
      .from('proposals')
      .update({ content: content as unknown as Record<string, unknown> })
      .eq('id', id)
      .select('*')
      .single();

    if (error) {
      throw error;
    }
    return toProposal(data);
  }

  async remove(id: string): Promise<void> {
    const { error } = await this.supabase.client.from('proposals').delete().eq('id', id);
    if (error) {
      throw error;
    }
  }

  async publish(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('publish_proposal', { p_id: id });
    if (error) {
      throw error;
    }
  }

  async unpublish(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('unpublish_proposal', { p_id: id });
    if (error) {
      throw error;
    }
  }

  /** El código en texto plano viaja únicamente en este parámetro — nunca se
   *  guarda en `content` ni en ninguna columna de `proposals`; Supabase lo
   *  hashea y lo persiste en proposal_access_credentials, tabla a la que
   *  Angular nunca accede directo (ver 0035_proposal_access_credentials.sql). */
  async setAccessCode(id: string, code: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_proposal_access_code', { p_id: id, p_code: code });
    if (error) {
      throw error;
    }
  }

  /** El código plano viaja SOLO en el valor de retorno de esta llamada —
   *  Supabase lo genera con pgcrypto (nunca Math.random/timestamps/OpenAI),
   *  lo hashea y persiste el hash en proposal_access_credentials, y borra
   *  las sesiones de acceso existentes (mismo criterio que setAccessCode:
   *  un código nuevo invalida el anterior). El componente que llama a esto
   *  es responsable de no guardar el valor devuelto en ningún lado más allá
   *  de un signal en memoria para mostrarlo una vez. */
  async generateAccessCode(id: string): Promise<string> {
    const { data, error } = await this.supabase.client.rpc('generate_proposal_access_code', { p_id: id });
    if (error) {
      throw error;
    }
    return data as string;
  }

  /** Nunca expone el hash — solo si ya hay una credencial configurada, para
   *  que el builder pueda mostrar "Código configurado" en vez de reabrir el
   *  formulario de "establecer código" cada vez que se recarga la página. */
  async hasAccessCode(id: string): Promise<boolean> {
    const { data, error } = await this.supabase.client.rpc('proposal_has_access_code', { p_id: id });
    if (error) {
      throw error;
    }
    return data === true;
  }

  /** Único punto de "enviar al cliente" — la Edge Function resuelve
   *  destinatario/URL/status server-side; Angular solo manda el proposalId.
   *  Nunca se manda el código de acceso en este llamado (va por otro canal,
   *  a propósito). */
  async sendToClient(id: string): Promise<{ sentTo: string; sentAt: string }> {
    const { data, error } = await this.supabase.client.functions.invoke<{
      ok?: boolean;
      sentTo?: string;
      sentAt?: string;
      error?: string;
    }>('send-proposal', {
      body: { mode: 'proposal', proposalId: id }
    });

    if (error) {
      const parsed = await this.tryParseErrorBody(error);
      throw new Error(parsed ?? 'No se pudo enviar la propuesta. Inténtalo nuevamente.');
    }
    if (!data?.ok || !data.sentTo || !data.sentAt) {
      throw new Error(data?.error ?? 'No se pudo enviar la propuesta. Inténtalo nuevamente.');
    }
    return { sentTo: data.sentTo, sentAt: data.sentAt };
  }

  private async tryParseErrorBody(error: unknown): Promise<string | null> {
    const context = (error as { context?: Response })?.context;
    if (!context || typeof context.json !== 'function') {
      return null;
    }
    try {
      const body = await context.json();
      return typeof body?.error === 'string' ? body.error : null;
    } catch {
      return null;
    }
  }
}
