import { Injectable, inject } from '@angular/core';
import { AuthService } from './auth';
import { SupabaseService } from './supabase';
import { StoredExtraction } from '../models/proposal-extraction.types';
import { importStoragePath } from '../utils/pdf-import';

export type OriginChannel = 'web' | 'whatsapp' | 'email' | 'phone' | 'referral' | 'other';

export interface ImportStatusRow {
  id: string;
  status: 'uploaded' | 'processing' | 'ready' | 'applied' | 'failed';
  error: string | null;
  extracted: StoredExtraction | null;
  proposal_id: string | null;
}

export interface LeadOption {
  id: string;
  name: string;
  email: string | null;
}

const BUCKET = 'proposal-imports';

/**
 * Importación de una propuesta desde un PDF (modo "nueva"): sube el archivo, registra la importación,
 * pide a The Edit Assistant que lo lea (import-proposal-pdf) y, con la vista previa aprobada, crea la
 * propuesta en borrador (apply-proposal-import). La clave de OpenAI nunca pasa por aquí: vive solo
 * como secret de la Edge Function.
 */
@Injectable({ providedIn: 'root' })
export class ProposalImportService {
  private readonly supabase = inject(SupabaseService);
  private readonly auth = inject(AuthService);

  /** Sube el PDF como <uid>/<uuid>.pdf y crea la fila de la importación; devuelve su id. */
  async upload(file: File): Promise<string> {
    const userId = this.auth.profile()?.id;
    if (!userId) {
      throw new Error('Tu sesión expiró. Vuelve a iniciar sesión.');
    }

    const path = importStoragePath(userId);
    const { error: uploadError } = await this.supabase.client.storage
      .from(BUCKET)
      .upload(path, file, { contentType: 'application/pdf', upsert: false });
    if (uploadError) {
      console.error('No se pudo subir el PDF.', uploadError);
      throw new Error('No se pudo subir el archivo. Revisa tu conexión e inténtalo de nuevo.');
    }

    const { data, error } = await this.supabase.client
      .from('proposal_imports')
      .insert({ file_path: path, mode: 'new', created_by: userId })
      .select('id')
      .single();
    if (error || !data) {
      console.error('No se pudo registrar la importación.', error);
      throw new Error('No se pudo registrar la importación. Inténtalo de nuevo.');
    }
    return data.id;
  }

  /** Pide a la Edge Function que procese el PDF (responde 202 y sigue en segundo plano). También sirve para reintentar. */
  async start(importId: string): Promise<void> {
    const { error } = await this.supabase.client.functions.invoke('import-proposal-pdf', { body: { import_id: importId } });
    if (!error) {
      return;
    }
    // 409: ya se está procesando (o ya terminó) — basta con seguir consultando el estado.
    if ((error as { context?: Response }).context?.status === 409) {
      return;
    }
    throw new Error((await this.parseErrorBody(error)) ?? 'No se pudo iniciar la lectura del PDF. Inténtalo de nuevo.');
  }

  async getStatus(importId: string): Promise<ImportStatusRow> {
    const { data, error } = await this.supabase.client
      .from('proposal_imports')
      .select('id, status, error, extracted, proposal_id')
      .eq('id', importId)
      .single();
    if (error || !data) {
      throw new Error('No se pudo consultar el estado de la importación.');
    }
    return data as unknown as ImportStatusRow;
  }

  /** Crea la propuesta en borrador a partir de lo extraído; devuelve el id de la propuesta. */
  async apply(importId: string, originChannel: OriginChannel, leadId: string | null): Promise<string> {
    const body: Record<string, unknown> = { import_id: importId, origin_channel: originChannel };
    if (leadId) {
      body['lead_id'] = leadId;
    }
    const { data, error } = await this.supabase.client.functions.invoke<{ proposal_id?: string }>('apply-proposal-import', { body });
    if (error) {
      throw new Error((await this.parseErrorBody(error)) ?? 'No se pudo crear la propuesta. Inténtalo de nuevo.');
    }
    if (!data?.proposal_id) {
      throw new Error('No se pudo crear la propuesta. Inténtalo de nuevo.');
    }
    return data.proposal_id;
  }

  /** Solicitudes visibles para quien importa (RLS: la asesora solo ve las suyas), las más recientes primero. */
  async listLeads(): Promise<LeadOption[]> {
    const { data, error } = await this.supabase.client
      .from('leads')
      .select('id, name, email')
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) {
      throw error;
    }
    return (data ?? []) as LeadOption[];
  }

  private async parseErrorBody(error: unknown): Promise<string | null> {
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
