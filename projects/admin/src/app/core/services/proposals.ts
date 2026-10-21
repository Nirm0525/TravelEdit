import { PublishProblem } from '../models/publish-readiness';
import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { ProposalServiceAttachmentsService } from './proposal-service-attachments';
import { Proposal, ProposalContent, createEmptyContentFor, toProposal } from '../models/proposal.model';
import { ProposalStatus, TRAVEL_STATUSES, TravelKind, statusLabelOf } from '../models/proposal-enums';

export interface ProposalListPage {
  items: Proposal[];
  total: number;
}

export interface ProposalListParams {
  /** Tipo de registro: el filtro va en la consulta a Supabase (nunca se carga todo y se filtra en Angular). */
  kind: TravelKind;
  page: number;
  pageSize: number;
  status?: ProposalStatus;
  search?: string;
}

export interface CreateProposalPayload {
  /** Se envía SIEMPRE explícito: la creación no depende del DEFAULT de la base. */
  kind: TravelKind;
  clientName: string;
  leadId?: string;
  /** Canal de origen; si falta, la base usa 'other'. */
  originChannel?: 'web' | 'whatsapp' | 'email' | 'phone' | 'referral' | 'other';
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
  clientEmail?: string | null;
  destinationText?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelersCount?: number | null;
  advisorId?: string | null;
  currency?: string;
  accessRequired?: boolean;
  expiresAt?: string | null;
}

/**
 * Los documentos adjuntos de la propuesta YA se eliminaron (Storage y metadata), pero el DELETE de la propuesta falló.
 * No se intenta restaurar nada: la purga es idempotente, así que volver a intentar eliminar la propuesta funciona.
 */
export const PROPOSAL_DOCUMENTS_PURGED_MESSAGE =
  'Los documentos de la propuesta ya se eliminaron, pero no fue posible eliminar la propuesta. Vuelve a intentarlo.';

export class ProposalDocumentsPurgedError extends Error {
  constructor() {
    super(PROPOSAL_DOCUMENTS_PURGED_MESSAGE);
    this.name = 'ProposalDocumentsPurgedError';
  }
}

/** Mensaje cuando la Edge Function rechaza un itinerario (409 KIND_NOT_SUPPORTED): no debería ocurrir porque la interfaz no ofrece la acción. */
export const KIND_NOT_SUPPORTED_MESSAGE = 'Esta acción solo está disponible para propuestas.';

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
  private readonly serviceAttachments = inject(ProposalServiceAttachmentsService);
  private readonly auth = inject(AuthService);

  async list(params: ProposalListParams): Promise<ProposalListPage> {
    const from = (params.page - 1) * params.pageSize;
    const to = from + params.pageSize - 1;

    let query = this.supabase.client
      .from('proposals')
      .select('*', { count: 'exact' })
      .eq('kind', params.kind)
      .order('updated_at', { ascending: false })
      .range(from, to);

    if (params.status) {
      query = query.eq('status', params.status);
    }
    if (params.search) {
      const term = `%${params.search}%`;
      const orParts = [`client_name.ilike.${term}`, `destination_text.ilike.${term}`];
      // "Buscar por cliente, destino o estado" — el estado se compara contra
      // su etiqueta en español (lo único que el staff realmente escribe),
      // nunca contra el valor crudo del enum en inglés.
      const searchLower = params.search.toLowerCase();
      for (const status of TRAVEL_STATUSES[params.kind]) {
        if (statusLabelOf(params.kind, status).toLowerCase().includes(searchLower)) {
          orParts.push(`status.eq.${status}`);
        }
      }
      query = query.or(orParts.join(','));
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

  /** Conteos globales por estado de UN tipo para los chips de filtro de la lista — no
   *  dependen de la búsqueda/paginación actual, así que se piden aparte con
   *  `head: true` (solo count, sin traer filas) en vez de derivarse de la
   *  página cargada. Solo se consultan los estados que ese tipo tiene; el resto queda en 0. */
  async countsByStatus(kind: TravelKind): Promise<Record<ProposalStatus, number>> {
    const counts = await Promise.all(
      TRAVEL_STATUSES[kind].map(async (status) => {
        const { count, error } = await this.supabase.client
          .from('proposals')
          .select('*', { count: 'exact', head: true })
          .eq('kind', kind)
          .eq('status', status);
        if (error) {
          throw error;
        }
        return [status, count ?? 0] as const;
      })
    );
    return { draft: 0, shared: 0, published: 0, viewed: 0, accepted: 0, expired: 0, ...Object.fromEntries(counts) } as Record<ProposalStatus, number>;
  }

  /**
   * Lee un registro por id, de CUALQUIER tipo: el `kind` de la fila es la fuente de verdad. Quien lo use para un modo concreto
   * (el editor) debe comparar `proposal.kind` con el modo de la ruta y redirigir, nunca asumir el tipo por la URL.
   */
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
        kind: payload.kind,
        client_name: payload.clientName,
        lead_id: payload.leadId ?? null,
        ...(payload.originChannel ? { origin_channel: payload.originChannel } : {}),
        destination_text: payload.destinationText ?? null,
        travelers_count: payload.travelersCount ?? null,
        start_date: payload.startDate ?? null,
        end_date: payload.endDate ?? null,
        // Una propuesta nace con los términos de partida (editables) ya cargados; un itinerario, sin nada contractual.
        content: createEmptyContentFor(payload.kind) as unknown as Record<string, unknown>,
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
      .eq('kind', 'proposal')
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
        client_email: patch.clientEmail,
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
    // Los documentos adjuntos viven en un bucket privado: la cascada de la base borraría solo las filas y dejaría los
    // archivos huérfanos. Orden: 1) objetos de Storage, 2) metadata (ambos en purge-proposal), 3) la propuesta.
    // Si la purga falla, la propuesta NO se elimina. Si la purga termina y falla el DELETE, la propuesta queda viva
    // sin documentos a propósito (preferible a dejar archivos sensibles huérfanos): se avisa con un error claro y
    // volver a intentar funciona, porque no quedan documentos que purgar.
    const documents = await this.serviceAttachments.listForProposal(id);
    const purged = documents.length > 0;
    if (purged) {
      await this.serviceAttachments.purgeProposal(id);
    }
    let failure: unknown = null;
    try {
      const { error } = await this.supabase.client.from('proposals').delete().eq('id', id);
      failure = error;
    } catch (err) {
      failure = err;
    }
    if (failure) {
      throw purged ? new ProposalDocumentsPurgedError() : failure;
    }
  }

  async publish(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('publish_proposal', { p_id: id });
    if (error) {
      throw error;
    }
  }

  /**
   * Lista de pendientes para publicar (migración 0053): la misma función que usa publish_proposal().
   * Devuelve null si no se pudo saber (p. ej. la migración todavía no está aplicada): quien llama no
   * debe bloquear la publicación por eso — la base sigue siendo la que decide al publicar.
   */
  async getPublishReadiness(id: string): Promise<PublishProblem[] | null> {
    const { data, error } = await this.supabase.client.rpc('get_publish_readiness', { p_id: id });
    if (error) {
      console.error('No se pudo consultar qué falta para publicar.', error);
      return null;
    }
    return ((data ?? []) as unknown as PublishProblem[]).slice().sort((a, b) => a.position - b.position);
  }

  // ------------------------------------------------------------------ itinerarios: compartir (migración 0056)
  // NUNCA se reutilizan publish/unpublish ni send-proposal: un itinerario se comparte con sus propias RPC y su propia Edge Function.

  /**
   * Lista de pendientes para compartir un itinerario (get_itinerary_share_readiness): la misma que revisa share_itinerary en el
   * servidor. null si no se pudo saber: quien llama no debe bloquear por eso, la base decide al compartir.
   */
  async getItineraryShareReadiness(id: string, forEmail = false): Promise<PublishProblem[] | null> {
    const { data, error } = await this.supabase.client.rpc('get_itinerary_share_readiness', { p_id: id, p_for_email: forEmail });
    if (error) {
      console.error('No se pudo consultar qué falta para compartir.', error);
      return null;
    }
    return ((data ?? []) as unknown as PublishProblem[]).slice().sort((a, b) => a.position - b.position);
  }

  async shareItinerary(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('share_itinerary', { p_id: id });
    if (error) {
      throw error;
    }
  }

  async unshareItinerary(id: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('unshare_itinerary', { p_id: id });
    if (error) {
      throw error;
    }
  }

  /** «Enviar al cliente» de un itinerario COMPARTIDO: send-itinerary resuelve destinatario y enlace en el servidor; solo se manda el id. */
  async sendItineraryToClient(id: string): Promise<{ sentTo: string; sentAt: string }> {
    const { data, error } = await this.supabase.client.functions.invoke<{ ok?: boolean; sentTo?: string; sentAt?: string; error?: string }>(
      'send-itinerary',
      { body: { itineraryId: id } }
    );
    if (error) {
      const parsed = await this.tryParseErrorBody(error, 'Este envío es solo para itinerarios.');
      throw new Error(parsed ?? 'No se pudo enviar el itinerario. Inténtalo nuevamente.');
    }
    if (!data?.ok || !data.sentTo || !data.sentAt) {
      throw new Error(data?.error ?? 'No se pudo enviar el itinerario. Inténtalo nuevamente.');
    }
    return { sentTo: data.sentTo, sentAt: data.sentAt };
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

  private async tryParseErrorBody(error: unknown, kindMessage = KIND_NOT_SUPPORTED_MESSAGE): Promise<string | null> {
    const context = (error as { context?: Response })?.context;
    if (!context || typeof context.json !== 'function') {
      return null;
    }
    try {
      const body = await context.json();
      // Un itinerario no se envía por aquí (409): mensaje propio, sin el texto técnico del servidor.
      if (body?.code === 'KIND_NOT_SUPPORTED') {
        return kindMessage;
      }
      // Los mensajes de send-itinerary ya vienen en español y pensados para la asesora (primero compartir, falta correo, acceso vencido…).
      return typeof body?.error === 'string' ? body.error : null;
    } catch {
      return null;
    }
  }
}
