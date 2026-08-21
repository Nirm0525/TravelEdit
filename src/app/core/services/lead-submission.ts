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
    const { data, error } = await this.supabase.client.functions.invoke<{ ok?: boolean; error?: string }>(
      'submit-lead',
      { body: payload }
    );

    if (error || !data?.ok) {
      return { ok: false, error: data?.error ?? 'No se pudo enviar tu solicitud. Intenta de nuevo.' };
    }

    return { ok: true };
  }
}
