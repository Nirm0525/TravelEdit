import { Injectable, inject } from '@angular/core';
import { FunctionsFetchError, FunctionsHttpError, FunctionsRelayError } from '@supabase/supabase-js';
import { SupabaseService } from './supabase';
import { IntegrationStatus, SITE_SETTINGS_DEFAULTS, SiteSettingKey, SiteSettingsMap } from '../models/site-settings.model';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly supabase = inject(SupabaseService);

  private cache: SiteSettingsMap | null = null;
  private pending: Promise<SiteSettingsMap> | null = null;

  async getSettings(): Promise<SiteSettingsMap> {
    if (this.cache) {
      return this.cache;
    }
    if (!this.pending) {
      this.pending = this.fetchSettings();
    }
    this.cache = await this.pending;
    this.pending = null;
    return this.cache;
  }

  async getSetting<K extends SiteSettingKey>(key: K): Promise<SiteSettingsMap[K]> {
    const settings = await this.getSettings();
    return settings[key];
  }

  /**
   * Actualiza una sola clave: `update site_settings set value = ... where key = ...`.
   * `updated_at`/`updated_by` nunca se mandan desde acá — los fija el trigger
   * `set_site_setting_audit_fields` en Supabase (0019_site_settings.sql).
   *
   * Importante: se pide `.select('key')` a propósito. Sin eso, PostgREST
   * responde `return=minimal` y `data` siempre viene null — un UPDATE que
   * RLS bloquea silenciosamente (0 filas afectadas) NO genera `error`, así
   * que sin verificar `data` el guardado parecería exitoso aunque Supabase
   * no haya escrito nada.
   */
  async updateSetting<K extends SiteSettingKey>(key: K, value: SiteSettingsMap[K]): Promise<void> {
    const { data, error } = await this.supabase.client
      .from('site_settings')
      .update({ value: value as unknown })
      .eq('key', key)
      .select('key');

    if (error) {
      console.error(`SettingsService.updateSetting: Supabase rechazó "${key}".`, error);
      throw new Error(`No se pudo guardar "${key}": ${error.message}`);
    }

    if (!data || data.length === 0) {
      console.error(
        `SettingsService.updateSetting: 0 filas actualizadas para "${key}" — la clave no existe en site_settings o RLS bloqueó la operación (revisa que el usuario tenga rol admin).`
      );
      throw new Error(`No se pudo guardar "${key}": no tienes permiso o la configuración no existe.`);
    }
  }

  /** Actualiza varias claves en paralelo reutilizando updateSetting(). Si alguna falla, lo reporta explícitamente
   *  (no oculta fallos parciales) y de todos modos invalida el cache para reflejar lo que sí se guardó. */
  async updateSettings(patch: Partial<SiteSettingsMap>): Promise<SiteSettingsMap> {
    const entries = Object.entries(patch) as [SiteSettingKey, SiteSettingsMap[SiteSettingKey]][];
    if (entries.length === 0) {
      return this.getSettings();
    }

    const outcomes = await Promise.all(
      entries.map(async ([key, value]) => {
        try {
          await this.updateSetting(key, value);
          return { key, error: null as string | null };
        } catch (err) {
          return { key, error: err instanceof Error ? err.message : 'error desconocido' };
        }
      })
    );
    this.cache = null;

    const failed = outcomes.filter((outcome) => outcome.error);
    if (failed.length > 0) {
      const detail = failed.map((outcome) => `${outcome.key}: ${outcome.error}`).join(' — ');
      throw new Error(`No se pudieron guardar ${failed.length} de ${entries.length} cambios (${detail}).`);
    }

    return this.getSettings();
  }

  /** Estado de RESEND_API_KEY — nunca el valor, solo si está configurado.
   *  Se resuelve en la Edge Function settings-status, el único lugar con acceso a ese secret. */
  async getIntegrationStatus(): Promise<IntegrationStatus> {
    const {
      data: { session },
      error: sessionError
    } = await this.supabase.client.auth.getSession();

    if (sessionError || !session?.access_token) {
      throw new Error('No hay una sesión autenticada. Vuelve a iniciar sesión.');
    }

    const { data, error } = await this.supabase.client.functions.invoke<
      IntegrationStatus & { error?: string; message?: string }
    >('settings-status', { headers: { Authorization: `Bearer ${session.access_token}` } });

    if (error) {
      throw new Error(await this.extractServerMessage(error));
    }
    if (data && 'error' in data && data.error) {
      throw new Error(String(data.error));
    }
    if (!data) {
      throw new Error('No se pudo conectar con el servidor. Intenta de nuevo.');
    }

    return { resendConfigured: data.resendConfigured };
  }

  private async extractServerMessage(error: unknown): Promise<string> {
    // FunctionsFetchError = el fetch nunca llegó a tener respuesta (red caída,
    // función no desplegada, o el navegador bloqueó la petición por CORS —
    // esto último es indistinguible de "sin red" desde JS, el navegador no
    // expone el motivo exacto). FunctionsRelayError = el gateway de Supabase
    // tuvo un problema antes de invocar la función. Ambos casos no tienen
    // Response real que leer.
    if (error instanceof FunctionsFetchError) {
      console.error('settings-status: fetch falló (posible red caída, función no desplegada, o bloqueo CORS del navegador).', error);
      return 'No se pudo conectar con el servidor de Supabase (red o CORS). Revisa la consola para más detalle.';
    }
    if (error instanceof FunctionsRelayError) {
      console.error('settings-status: error del relay de Supabase.', error);
      return 'Supabase tuvo un problema interno al invocar la función. Intenta de nuevo.';
    }

    // FunctionsHttpError = la función respondió con un status no-2xx —
    // context SÍ es un Response real con el body que la función mandó.
    if (error instanceof FunctionsHttpError) {
      try {
        const body = await error.context.json();
        if (body?.error) {
          return String(body.error);
        }
        if (body?.message) {
          return String(body.message);
        }
        return `La función respondió con un error (HTTP ${error.context.status}).`;
      } catch (parseErr) {
        console.error('settings-status: no se pudo parsear el body del error.', parseErr);
        return `La función respondió con un error (HTTP ${error.context.status}).`;
      }
    }

    console.error('settings-status: error inesperado.', error);
    return 'No se pudo conectar con el servidor. Intenta de nuevo.';
  }

  private async fetchSettings(): Promise<SiteSettingsMap> {
    const { data, error } = await this.supabase.client.from('site_settings').select('key, value');
    if (error) {
      throw error;
    }

    const settings: SiteSettingsMap = { ...SITE_SETTINGS_DEFAULTS };
    for (const row of data ?? []) {
      if (row.key in settings) {
        const key = row.key as SiteSettingKey;
        (settings[key] as unknown) = row.value;
      }
    }
    return settings;
  }
}
