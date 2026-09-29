import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { ProposalContent, toProposalContent } from '../models/proposal-content.model';

const PROPOSAL_IMAGES_BUCKET = 'proposal-images';

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
      travelersCount: row.travelers_count
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
      days: content.days.map((day) => ({ ...day, imagePath: this.resolveImageUrl(day.imagePath) }))
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
}
