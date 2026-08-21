import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { StaffRole } from '../models/staff-role';

export interface StaffProfile {
  id: string;
  fullName: string;
  role: StaffRole;
}

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private readonly supabase = inject(SupabaseService);

  private readonly _session = signal<Session | null>(null);
  private readonly _profile = signal<StaffProfile | null>(null);
  private readonly _status = signal<AuthStatus>('loading');

  readonly profile = this._profile.asReadonly();
  readonly status = this._status.asReadonly();
  readonly isSignedIn = computed(() => this._status() === 'signed-in');
  readonly isAdmin = computed(() => this._profile()?.role === 'admin');

  private readonly readyPromise: Promise<void>;

  constructor() {
    this.readyPromise = this.supabase.client.auth
      .getSession()
      .then(({ data }) => this.applySession(data.session));

    this.supabase.client.auth.onAuthStateChange((_event, session) => {
      void this.applySession(session);
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  async signInWithPassword(email: string, password: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.auth.signInWithPassword({ email, password });

    if (error) {
      return { error: this.translateAuthError(error.message) };
    }

    return { error: null };
  }

  async signOut(): Promise<void> {
    await this.supabase.client.auth.signOut();
  }

  private async applySession(session: Session | null): Promise<void> {
    this._session.set(session);

    if (!session) {
      this._profile.set(null);
      this._status.set('signed-out');
      return;
    }

    const { data, error } = await this.supabase.client
      .from('profiles')
      .select('id, full_name, role')
      .eq('id', session.user.id)
      .single();

    if (error || !data) {
      this._profile.set(null);
      this._status.set('signed-out');
      return;
    }

    this._profile.set({ id: data.id, fullName: data.full_name, role: data.role });
    this._status.set('signed-in');
  }

  private translateAuthError(message: string): string {
    if (message.toLowerCase().includes('invalid login credentials')) {
      return 'Correo o contraseña incorrectos.';
    }
    return 'No se pudo iniciar sesión. Intenta de nuevo.';
  }
}
