import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { AdminUser, CreateUserPayload, UpdateUserPayload } from '../models/user.model';

@Injectable({
  providedIn: 'root'
})
export class AdminUsersService {
  private readonly supabase = inject(SupabaseService);

  async listUsers(): Promise<AdminUser[]> {
    const { data, error } = await this.invoke<{ users?: AdminUser[] }>({ action: 'list' });
    if (error || !data?.users) {
      throw new Error(error ?? 'No se pudo cargar la lista de usuarios.');
    }
    return data.users;
  }

  async createUser(payload: CreateUserPayload): Promise<void> {
    const { error } = await this.invoke({ action: 'create', ...payload });
    if (error) {
      throw new Error(error);
    }
  }

  async updateUser(payload: UpdateUserPayload): Promise<void> {
    const { error } = await this.invoke({ action: 'update', ...payload });
    if (error) {
      throw new Error(error);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const { error } = await this.invoke({ action: 'delete', userId });
    if (error) {
      throw new Error(error);
    }
  }

  private async invoke<T>(body: Record<string, unknown>): Promise<{ data: T | null; error: string | null }> {
    // functions.invoke() debería adjuntar el access_token de la sesión activa
    // solo — pero lo pedimos explícito para no depender de ese comportamiento
    // implícito y poder distinguir "no hay sesión" de un error real del servidor.
    const {
      data: { session },
      error: sessionError
    } = await this.supabase.client.auth.getSession();

    if (sessionError || !session?.access_token) {
      return { data: null, error: 'No hay una sesión autenticada. Vuelve a iniciar sesión.' };
    }

    const { data, error } = await this.supabase.client.functions.invoke<T & { error?: string; message?: string }>(
      'admin-users',
      { body, headers: { Authorization: `Bearer ${session.access_token}` } }
    );

    if (error) {
      // Para cualquier respuesta que no sea 2xx (401/403/400/500), functions.invoke()
      // la reporta como error del cliente en vez de como `data` — el cuerpo JSON real
      // que mandó la función (con el mensaje útil) queda en error.context.
      return { data: null, error: await this.extractServerMessage(error) };
    }
    if (data && typeof data === 'object' && 'error' in data && data.error) {
      return { data: null, error: String(data.error) };
    }
    return { data: data as T, error: null };
  }

  private async extractServerMessage(error: unknown): Promise<string> {
    const context = (error as { context?: Response } | null)?.context;
    if (context && typeof context.json === 'function') {
      try {
        const body = await context.json();
        if (body?.error) {
          return String(body.error);
        }
        if (body?.message) {
          return String(body.message);
        }
      } catch {
        // La respuesta no era JSON — se usa el mensaje genérico de abajo.
      }
    }
    return 'No se pudo conectar con el servidor. Intenta de nuevo.';
  }
}
