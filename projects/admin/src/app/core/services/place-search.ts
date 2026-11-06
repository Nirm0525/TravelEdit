import { Injectable, inject } from '@angular/core';
import { SupabaseService } from './supabase';
import { ProposalPlace, toSafePlace } from '../models/proposal-location';

/** Candidato que devuelve la Edge Function geocode-place (Geoapify por defecto; datos de OpenStreetMap). */
export interface PlaceCandidate {
  provider: 'osm';
  /** Quién geocodificó (determina la atribución obligatoria). Ausente en respuestas de versiones anteriores. */
  geocoder?: 'geoapify' | 'nominatim';
  placeId?: string | null;
  /** Identificador OSM: solo si el proveedor lo informó (no todo resultado lo tiene). */
  osmType: 'node' | 'way' | 'relation' | null;
  osmId: number | null;
  name: string;
  address: string;
  lat: number;
  lon: number;
  /** [sur, oeste, norte, este] */
  bbox: [number, number, number, number] | null;
  /** Procedencia de los datos según el proveedor, su atribución y su licencia (texto plano). */
  dataSource?: string | null;
  attribution?: string | null;
  license?: string | null;
  /** Ciudad y país del resultado, si el proveedor los informó (se muestran en las sugerencias). */
  city?: string | null;
  country?: string | null;
}

/** Preferencia geográfica del autocompletado: coordenadas de un lugar ya guardado (nunca supuestas). */
export interface PlaceBias {
  lat: number;
  lon: number;
}

/** Sugerencias del autocompletado: como máximo 5, y solo desde 4 caracteres. */
export const MAX_SUGGESTIONS = 5;
export const MIN_SUGGEST_LENGTH = 4;
/** Espera sin escribir antes de pedir sugerencias. */
export const SUGGEST_DEBOUNCE_MS = 700;

export interface PlaceSearchResponse {
  success: boolean;
  results?: PlaceCandidate[];
  cached?: boolean;
  attribution?: string;
  error?: string;
  retryAfterSeconds?: number;
  /** Estado HTTP real con el que respondió el proveedor (solo si fue él quien rechazó la búsqueda). */
  providerStatus?: number;
  /** 'provider' = el proveedor pidió esperar (Retry-After); 'default' = pausa nuestra porque no dijo cuánto. */
  retryAfterSource?: 'provider' | 'default';
  /** Límite diario de búsquedas nuevas (solo en quota_exhausted). */
  dailyLimit?: number;
}

/**
 * Búsqueda de ubicaciones: ÚNICA puerta hacia el geocodificador, siempre a través de la Edge Function geocode-place (que
 * autentica a la asesora, aplica la caché y el límite global del proveedor). Angular nunca llama al proveedor directo.
 * Este servicio no hace debounce ni reacciona al texto: quien lo usa decide cuándo consultar (el botón «Buscar ubicación» o las
 * sugerencias al escribir, que gestiona el editor). Ambas comparten la caché y la cuota diaria del servidor.
 */
@Injectable({ providedIn: 'root' })
export class PlaceSearchService {
  private readonly supabase = inject(SupabaseService);

  async search(query: string): Promise<PlaceSearchResponse> {
    const { data, error } = await this.supabase.client.functions.invoke<PlaceSearchResponse>('geocode-place', { body: { query } });
    if (error) {
      return { success: false, ...(await this.readErrorBody(error)) };
    }
    if (!data || data.success !== true || !Array.isArray(data.results)) {
      return { success: false, error: 'unexpected_error' };
    }
    // Se vuelve a validar lo recibido: solo candidatos con coordenadas válidas y a lo sumo 3.
    return { ...data, results: data.results.filter((candidate) => !!candidatePlace(candidate)).slice(0, 3) };
  }

  /**
   * Sugerencias al escribir (mode «autocomplete»; hasta 5). `signal` cancela la petición del NAVEGADOR cuando ya no interesa; ojo: si el
   * servidor ya la había enviado al proveedor, esa llamada se cuenta igualmente en la cuota (cancelar aquí no la evita).
   * Si se cancela devuelve { success: false, error: 'aborted' } y quien llama debe ignorarlo.
   */
  async suggest(query: string, bias?: PlaceBias | null, signal?: AbortSignal): Promise<PlaceSearchResponse> {
    const body: Record<string, unknown> = { query, mode: 'autocomplete' };
    if (bias && Number.isFinite(bias.lat) && Number.isFinite(bias.lon)) {
      body['bias'] = { lat: bias.lat, lon: bias.lon };
    }
    try {
      const { data, error } = await this.supabase.client.functions.invoke<PlaceSearchResponse>('geocode-place', { body, ...(signal ? { signal } : {}) });
      if (signal?.aborted) {
        return { success: false, error: 'aborted' };
      }
      if (error) {
        return { success: false, ...(await this.readErrorBody(error)) };
      }
      if (!data || data.success !== true || !Array.isArray(data.results)) {
        return { success: false, error: 'unexpected_error' };
      }
      return { ...data, results: data.results.filter((candidate) => !!candidatePlace(candidate)).slice(0, MAX_SUGGESTIONS) };
    } catch {
      return { success: false, error: signal?.aborted ? 'aborted' : 'network_failure' };
    }
  }

  private async readErrorBody(error: unknown): Promise<Pick<PlaceSearchResponse, 'error' | 'retryAfterSeconds' | 'providerStatus' | 'retryAfterSource' | 'dailyLimit'>> {
    const context = (error as { context?: Response })?.context;
    if (!context || typeof context.json !== 'function') {
      return { error: 'network_failure' };
    }
    try {
      const body = await context.json();
      return {
        error: typeof body?.error === 'string' ? body.error : 'network_failure',
        ...(typeof body?.retryAfterSeconds === 'number' ? { retryAfterSeconds: body.retryAfterSeconds } : {}),
        ...(typeof body?.providerStatus === 'number' ? { providerStatus: body.providerStatus } : {}),
        ...(body?.retryAfterSource === 'provider' || body?.retryAfterSource === 'default' ? { retryAfterSource: body.retryAfterSource } : {}),
        ...(typeof body?.dailyLimit === 'number' ? { dailyLimit: body.dailyLimit } : {})
      };
    } catch {
      return { error: 'network_failure' };
    }
  }
}

/** El lugar que se guarda para un candidato (validado); undefined si no es válido. */
export function candidatePlace(candidate: PlaceCandidate): ProposalPlace | undefined {
  return toSafePlace({
    provider: candidate.provider,
    lat: candidate.lat,
    lon: candidate.lon,
    bbox: candidate.bbox ?? undefined,
    osmType: candidate.osmType ?? undefined,
    osmId: candidate.osmId ?? undefined,
    // Procedencia y atribución del resultado (nada de esto se supone: solo lo que el proveedor informó).
    geocoder: candidate.geocoder,
    placeId: candidate.placeId ?? undefined,
    dataSource: candidate.dataSource ?? undefined,
    attribution: candidate.attribution ?? undefined,
    license: candidate.license ?? undefined
  });
}

/**
 * Mensaje de las sugerencias cuando se pausan solas (cuota diaria agotada o pausa del proveedor). La búsqueda explícita sigue disponible:
 * consulta lo ya guardado en la caché y, si es nueva, recibirá el aviso correspondiente.
 */
export function suggestionPauseMessage(error: string | undefined, retryAfterSeconds?: number): string {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? formatWait(retryAfterSeconds) : null;
  if (error === 'quota_exhausted') {
    return `Se alcanzó el límite diario de consultas nuevas: las sugerencias están en pausa${wait ? ` (se reanudan en ${wait})` : ''}. «Buscar ubicación» sigue mostrando los lugares ya buscados; también puedes pegar el código de Google Maps.`;
  }
  return `El servicio de mapas pidió una pausa: las sugerencias se detienen${wait ? ` ${wait}` : ' un momento'}. «Buscar ubicación» sigue disponible para lugares ya buscados, o pega el código de Google Maps.`;
}

/** «45 segundos», «2 minutos», «1 hora». */
export function formatWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
  }
  if (seconds < 3600) {
    const minutes = Math.ceil(seconds / 60);
    return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }
  if (seconds < 86400) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours} hora${hours === 1 ? '' : 's'}`;
  }
  const days = Math.ceil(seconds / 86400);
  return `${days} día${days === 1 ? '' : 's'}`;
}

/**
 * Mensaje para la asesora según el código de error de la función. Distingue tres cosas distintas:
 *  - «busy»: espera INTERNA breve (otras búsquedas en curso); no es un problema del proveedor.
 *  - «provider_limited»: el proveedor limitó el uso; si envió Retry-After se muestra su espera, si no, la pausa por defecto.
 *  - «quota_exhausted»: se agotó el límite DIARIO de búsquedas nuevas de la integración; lo ya buscado sigue disponible.
 *  - «provider_blocked»: el proveedor rechazó la solicitud del servidor (HTTP 403). Un 403 no dice por qué: no se afirma ninguna causa.
 */
export function placeSearchMessage(
  error: string | undefined,
  retryAfterSeconds?: number,
  details: { providerStatus?: number; retryAfterSource?: 'provider' | 'default'; dailyLimit?: number } = {}
): string {
  const wait = retryAfterSeconds && retryAfterSeconds > 0 ? formatWait(retryAfterSeconds) : null;
  const status = details.providerStatus ? ` (HTTP ${details.providerStatus})` : '';
  switch (error) {
    case 'invalid_query':
      return 'Escribe al menos 3 caracteres para buscar.';
    case 'query_too_long':
      return 'La búsqueda es demasiado larga. Acórtala.';
    case 'busy':
      return `El servicio de búsqueda está atendiendo otras consultas en este momento. Inténtalo de nuevo en ${wait ?? 'unos instantes'}.`;
    case 'provider_limited':
      return details.retryAfterSource === 'provider'
        ? `El proveedor de búsqueda pidió esperar ${wait ?? 'un momento'} antes de aceptar más búsquedas${status}. Podrás volver a buscar entonces.`
        : `El proveedor de búsqueda rechazó la búsqueda por límite de uso${status} sin indicar cuánto esperar. Las búsquedas quedan en pausa ${wait ?? 'unos minutos'}.`;
    case 'quota_exhausted':
      return `Se alcanzó el límite diario de búsquedas nuevas${details.dailyLimit ? ` (${details.dailyLimit})` : ''}. Las ubicaciones ya buscadas siguen disponibles. Podrás buscar lugares nuevos en ${wait ?? 'unas horas'}. Mientras tanto, pega el código de Google Maps.`;
    case 'provider_blocked':
      return 'El proveedor rechazó la solicitud del servidor. Contacta al administrador.';
    case 'timeout':
      return 'El servicio de mapas tardó demasiado en responder. Inténtalo de nuevo.';
    case 'provider_unavailable':
      return `El servicio de mapas no está disponible ahora${status}${wait ? `; podrás buscar de nuevo en ${wait}` : ''}. Mientras tanto, pega el código de Google Maps.`;
    case 'autocomplete_unsupported':
      return 'Las sugerencias al escribir no están disponibles con este proveedor. Usa «Buscar ubicación».';
    case 'provider_not_configured':
      return 'La búsqueda de ubicaciones no está configurada. Avisa al administrador o pega el código de Google Maps.';
    case 'unauthorized':
    case 'forbidden':
      return 'No tienes permiso para buscar ubicaciones. Vuelve a iniciar sesión.';
    default:
      return 'No se pudo buscar la ubicación. Revisa tu conexión e inténtalo de nuevo.';
  }
}
