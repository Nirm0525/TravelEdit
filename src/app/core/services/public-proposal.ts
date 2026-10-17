import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { ProposalContent, toProposalContent } from '../models/proposal-content.model';

const PROPOSAL_IMAGES_BUCKET = 'proposal-images';

/** Clave de sessionStorage donde la propuesta guarda su sesión de acceso (la
 *  página de términos lee la misma, ver PrivateProposalTerms). */
export const PROPOSAL_SESSION_PREFIX = 'te-proposal-session:';

export type ProposalStatus = 'draft' | 'published' | 'viewed' | 'accepted' | 'expired';

// Mismos 5 valores que verify_proposal_access() devuelve en la columna
// `result` (supabase/migrations/0035_proposal_access_credentials.sql) — el
// backend NUNCA lanza una excepción de Postgres para estos casos, son
// estados normales de UI que este servicio expone tal cual, sin
// reinterpretarlos como errores.
export type ProposalAccessResult = 'ok' | 'not_found' | 'access_not_configured' | 'locked' | 'invalid_code';

export interface ProposalGateResponse {
  accessRequired: boolean;
  clientName: string;
  coverTitle: string | null;
  coverImagePath: string | null;
  status: ProposalStatus;
}

export interface ProposalAccessResponse {
  result: ProposalAccessResult;
  sessionToken: string | null;
  sessionExpiresAt: string | null;
}

export interface PublicProposalData {
  content: ProposalContent;
  pricingSubtotal: number;
  pricingFees: number;
  pricingTotal: number;
  currency: string;
  status: ProposalStatus;
  termsAccepted: boolean;
  acceptedAt: string | null;
  clientName: string;
  destinationText: string | null;
  startDate: string | null;
  endDate: string | null;
  travelersCount: number | null;
  /** { [serviceId]: true|false } — lo que el cliente ya aceptó/descartó de
   *  cada servicio. Vacío si nunca marcó nada. */
  serviceChoices: Record<string, boolean>;
  /** { [serviceId]: texto } — comentarios / pedidos de cambio del cliente. */
  serviceComments: Record<string, string>;
}

function toServiceComments(value: Record<string, unknown> | null | undefined): Record<string, string> {
  const comments: Record<string, string> = {};
  for (const [key, text] of Object.entries(value ?? {})) {
    if (typeof text === 'string' && text.trim()) {
      comments[key] = text;
    }
  }
  return comments;
}

function toServiceChoices(value: Record<string, unknown> | null | undefined): Record<string, boolean> {
  const choices: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value ?? {})) {
    choices[key] = flag === true;
  }
  return choices;
}

interface GateRpcRow {
  access_required: boolean;
  client_name: string;
  cover_title: string | null;
  cover_image_path: string | null;
  status: ProposalStatus;
}

interface AccessRpcRow {
  result: ProposalAccessResult;
  session_token: string | null;
  session_expires_at: string | null;
}

interface ContentRpcRow {
  content: unknown;
  pricing_subtotal: number;
  pricing_fees: number;
  pricing_total: number;
  currency: string;
  status: ProposalStatus;
  terms_accepted: boolean;
  accepted_at: string | null;
  client_name: string;
  destination_text: string | null;
  start_date: string | null;
  end_date: string | null;
  travelers_count: number | null;
  /** Ausente si la migración 0043 todavía no se aplicó en la base. */
  service_choices?: Record<string, unknown> | null;
  /** Ausente si la migración 0044 todavía no se aplicó en la base. */
  service_comments?: Record<string, unknown> | null;
}

/**
 * Todo el acceso a una propuesta privada pasa por estas 4 RPC — nunca se
 * consulta `proposals`/`proposal_access_sessions`/`proposal_access_credentials`
 * directo (RLS las deja cerradas a `anon` a propósito, ver
 * supabase/migrations/0031_proposals_public_rpc.sql). El token de la URL por
 * sí solo nunca alcanza para leer contenido: getProposalGate() solo da lo
 * mínimo para pintar la pantalla de acceso, verifyAccess() es lo único que
 * puede emitir una sesión, y getContent()/acceptProposal() exigen esa sesión.
 */
@Injectable({
  providedIn: 'root'
})
export class PublicProposalService {
  private readonly supabase = inject(SupabaseService);

  async getProposalGate(token: string): Promise<ProposalGateResponse | null> {
    const { data, error } = await this.supabase.client.rpc('get_proposal_gate', { p_token: token });
    if (error) {
      throw error;
    }
    const row = (data as GateRpcRow[] | null)?.[0];
    if (!row) {
      return null;
    }
    return {
      accessRequired: row.access_required,
      clientName: row.client_name,
      coverTitle: row.cover_title,
      coverImagePath: this.resolveImageUrl(row.cover_image_path),
      status: row.status
    };
  }

  async verifyAccess(token: string, code: string | null): Promise<ProposalAccessResponse> {
    const { data, error } = await this.supabase.client.rpc('verify_proposal_access', {
      p_token: token,
      p_access_code: code
    });
    if (error) {
      throw error;
    }
    const row = (data as AccessRpcRow[] | null)?.[0];
    return {
      result: row?.result ?? 'not_found',
      sessionToken: row?.session_token ?? null,
      sessionExpiresAt: row?.session_expires_at ?? null
    };
  }

  async getContent(token: string, sessionToken: string): Promise<PublicProposalData> {
    const { data, error } = await this.supabase.client.rpc('get_proposal_content', {
      p_token: token,
      p_session_token: sessionToken
    });
    if (error) {
      throw error;
    }
    const row = (data as ContentRpcRow[] | null)?.[0];
    if (!row) {
      throw new Error('session_invalid');
    }
    return {
      content: this.resolveImagePaths(toProposalContent(row.content)),
      pricingSubtotal: Number(row.pricing_subtotal),
      pricingFees: Number(row.pricing_fees),
      pricingTotal: Number(row.pricing_total),
      currency: row.currency,
      status: row.status,
      termsAccepted: row.terms_accepted,
      acceptedAt: row.accepted_at,
      clientName: row.client_name,
      destinationText: row.destination_text,
      startDate: row.start_date,
      endDate: row.end_date,
      travelersCount: row.travelers_count,
      serviceChoices: toServiceChoices(row.service_choices),
      serviceComments: toServiceComments(row.service_comments)
    };
  }

  /** content.cover.imagePath / content.days[].imagePath llegan como
   *  storage_path relativos al bucket proposal-images (mismo criterio que
   *  ArticleImagesService/DestinationImagesService del admin, que suben con
   *  ProposalImagesService.upload() y guardan el path, no la URL) — hay que
   *  resolverlos a URL pública antes de que el template los use en <img src>. */
  private resolveImagePaths(content: ProposalContent): ProposalContent {
    return {
      ...content,
      cover: { ...content.cover, imagePath: this.resolveImageUrl(content.cover.imagePath) },
      days: content.days.map((day) => ({
        ...day,
        imagePath: this.resolveImageUrl(day.imagePath),
        services: day.services.map((service) => ({ ...service, imagePath: this.resolveImageUrl(service.imagePath) }))
      }))
    };
  }

  private resolveImageUrl(pathOrUrl: string | null): string | null {
    if (!pathOrUrl) {
      return null;
    }
    if (pathOrUrl.startsWith('http')) {
      return pathOrUrl;
    }
    return this.supabase.client.storage.from(PROPOSAL_IMAGES_BUCKET).getPublicUrl(pathOrUrl).data.publicUrl;
  }

  /** Marca/desmarca "Sí, por favor" en un servicio. Falla (RPC) si la sesión
   *  venció, si la propuesta ya fue aceptada o si el servicio no existe. */
  async setServiceChoice(token: string, sessionToken: string, serviceId: string, accepted: boolean): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_proposal_service_choice', {
      p_token: token,
      p_session_token: sessionToken,
      p_service_id: serviceId,
      p_accepted: accepted
    });
    if (error) {
      throw error;
    }
  }

  /** Guarda (o borra, si va vacío) el comentario del cliente sobre un servicio. */
  async setServiceComment(token: string, sessionToken: string, serviceId: string, comment: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('set_proposal_service_comment', {
      p_token: token,
      p_session_token: sessionToken,
      p_service_id: serviceId,
      p_comment: comment
    });
    if (error) {
      throw error;
    }
  }

  async acceptProposal(token: string, sessionToken: string, acceptedByName: string): Promise<void> {
    const { error } = await this.supabase.client.rpc('accept_proposal', {
      p_token: token,
      p_session_token: sessionToken,
      p_accepted_by_name: acceptedByName
    });
    if (error) {
      throw error;
    }
  }

  /**
   * Avisa al equipo (jefa + asesora) por correo. Es best-effort: el comentario
   * o la aceptacion ya quedaron guardados, asi que un fallo del aviso no debe
   * romper el flujo del cliente — quien llama decide que mostrar.
   */
  async notifyActivity(token: string, sessionToken: string, event: 'feedback' | 'accepted'): Promise<boolean> {
    try {
      const { data, error } = await this.supabase.client.functions.invoke<{ ok?: boolean }>('notify-proposal-activity', {
        body: { token, sessionToken, event }
      });
      return !error && !!data?.ok;
    } catch (err) {
      console.error('No se pudo avisar al equipo.', err);
      return false;
    }
  }
}
