import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

export type AiPolishOperation = 'improve' | 'luxury_rewrite' | 'concise' | 'expand' | 'title_options';

export interface AiPolishRequest {
  operation: AiPolishOperation;
  text: string;
  context?: {
    destination?: string;
    section?: string;
  };
}

export interface AiPolishResult {
  text?: string;
  alternatives?: string[];
}

export interface AiPolishResponse {
  success: boolean;
  result?: AiPolishResult;
  error?: string;
}

export interface AiChatTarget {
  key: string;
  label: string;
  currentText: string;
}

export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  mode: 'chat';
  message: string;
  targets: AiChatTarget[];
  history?: AiChatTurn[];
  context?: { destination?: string };
}

export interface AiChatResultAction {
  targetKey: string;
  suggestions: string[];
}

export interface AiChatResult {
  reply: string;
  /** Una entrada por cada campo distinto que el mensaje pidió editar —
   *  reemplaza el `targetKey`/`suggestions` singulares de antes, que solo
   *  podían expresar un campo por turno (la causa real de que pedidos como
   *  "mejora el título y la descripción" resolvieran solo uno). */
  actions: AiChatResultAction[];
  followUp: string | null;
}

export interface AiChatResponse {
  success: boolean;
  result?: AiChatResult;
  error?: string;
}

/**
 * Única puerta de entrada a "The Edit AI" desde Angular — llama
 * exclusivamente a la Edge Function proposal-ai-polish vía
 * supabase.functions.invoke() (mismo mecanismo que RichContentService usa
 * para save-rich-content). Nunca hace fetch directo a OpenAI: la API key
 * vive solo en Supabase Edge Function Secrets, Angular ni siquiera podría
 * usarla aunque quisiera.
 */
@Injectable({
  providedIn: 'root'
})
export class ProposalAiService {
  private readonly supabase = inject(SupabaseService);

  async polish(request: AiPolishRequest): Promise<AiPolishResponse> {
    const { data, error } = await this.supabase.client.functions.invoke<AiPolishResponse>('proposal-ai-polish', {
      body: request
    });

    if (error) {
      // supabase-js expone el body de error del Edge Function en
      // error.context cuando existe — se intenta leer el `error` que la
      // función ya devuelve tipado antes de caer a un mensaje genérico.
      const parsed = await this.tryParseErrorBody(error);
      return { success: false, error: parsed ?? 'network_failure' };
    }
    if (!data) {
      return { success: false, error: 'malformed_ai_response' };
    }
    return data;
  }

  async chat(request: Omit<AiChatRequest, 'mode'>): Promise<AiChatResponse> {
    const { data, error } = await this.supabase.client.functions.invoke<AiChatResponse>('proposal-ai-polish', {
      body: { mode: 'chat', ...request }
    });

    if (error) {
      const parsed = await this.tryParseErrorBody(error);
      return { success: false, error: parsed ?? 'network_failure' };
    }
    if (!data) {
      return { success: false, error: 'malformed_ai_response' };
    }
    return data;
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
