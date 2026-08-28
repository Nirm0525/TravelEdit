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

  async resetPasswordForEmail(email: string): Promise<{ error: string | null }> {
    // document.baseURI, no window.location.origin: en producción el admin
    // vive en /admin/ del mismo dominio (build con --base-href=/admin/,
    // ver comentario en environment.ts), y ese prefijo se pierde si se arma
    // la URL a mano solo con el origin.
    const redirectTo = new URL('restablecer-contrasena', document.baseURI).toString();
    const { error } = await this.supabase.client.auth.resetPasswordForEmail(email, { redirectTo });

    if (error) {
      console.error('No se pudo enviar el correo de recuperación.', error.message);
      return { error: 'No se pudo enviar el correo. Intenta de nuevo.' };
    }

    return { error: null };
  }

  async updatePassword(password: string): Promise<{ error: string | null }> {
    const { error } = await this.supabase.client.auth.updateUser({ password });

    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes('password') && message.includes('character')) {
        return { error: 'La contraseña debe tener al menos 6 caracteres.' };
      }
      if (message.includes('session') || message.includes('token')) {
        return { error: 'Este link ya expiró o no es válido. Solicita uno nuevo.' };
      }
      return { error: 'No se pudo actualizar la contraseña. Intenta de nuevo.' };
    }

    return { error: null };
  }

  async signOut(): Promise<void> {
    const { error } = await this.supabase.client.auth.signOut();
    if (error) {
      console.error('Error al notificar el cierre de sesión al servidor:', error.message);
    }

    // Se limpia el estado local pase lo que pase: si el usuario pidió salir,
    // no debe quedar atrapado en la sesión por un fallo de red al avisarle
    // al servidor — onAuthStateChange no siempre llega a tiempo en ese caso.
    this._session.set(null);
    this._profile.set(null);
    this._status.set('signed-out');
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
