import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type NewsletterResult =
  | { status: 'ok' }
  | { status: 'invalid' }
  | { status: 'duplicate' }
  | { status: 'error' };

@Injectable({
  providedIn: 'root'
})
export class NewsletterService {

  private readonly supabase = inject(SupabaseService);

  async subscribe(email: string): Promise<NewsletterResult> {
    const trimmed = email.trim();

    if (!EMAIL_PATTERN.test(trimmed)) {
      return { status: 'invalid' };
    }

    const { error } = await this.supabase.client
      .from('newsletter_subscribers')
      .insert({ email: trimmed });

    if (!error) {
      return { status: 'ok' };
    }

    if (error.code === '23505') {
      return { status: 'duplicate' };
    }

    return { status: 'error' };
  }
}
