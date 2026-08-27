import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { LeadTripDetails } from '../models/lead-trip-details';

export interface LeadSubmissionPayload {
  name: string;
  email: string;
  phone: string;
  destinationInterestText: string;
  details: LeadTripDetails;
  turnstileToken: string;
}

export type LeadSubmissionResult = { ok: true } | { ok: false; error: string };

@Injectable({
  providedIn: 'root'
})
export class LeadSubmissionService {
  private readonly supabase = inject(SupabaseService);

  async submit(payload: LeadSubmissionPayload): Promise<LeadSubmissionResult> {
    // functions.invoke() documenta que resuelve con {error} para fallos HTTP/red/CORS
    // en vez de rechazar la promesa, pero este try/catch cubre igual cualquier caso
    // no documentado — sin esto, una excepción inesperada aquí dejaría el botón de
    // envío del formulario bloqueado para siempre (submitting nunca vuelve a false).
    try {
      const { data, error } = await this.supabase.client.functions.invoke<{ ok?: boolean; error?: string }>(
        'submit-lead',
        { body: payload }
      );

      if (error || !data?.ok) {
        return { ok: false, error: data?.error ?? 'No se pudo enviar tu solicitud. Intenta de nuevo.' };
      }

      return { ok: true };
    } catch (err) {
      console.error('LeadSubmissionService.submit: error inesperado', err);
      return { ok: false, error: 'No se pudo enviar tu solicitud. Intenta de nuevo.' };
    }
  }
}
