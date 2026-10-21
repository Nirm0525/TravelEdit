import { InjectionToken, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { PermissionCode } from '../../core/data/permissions';

/**
 * Módulo padre «Viajes»: Propuestas e Itinerarios comparten el mismo builder y la misma lista; lo que cambia por modo
 * vive AQUÍ, en una sola configuración, para no repartir `if (mode === …)` por todo el código.
 */
export type TravelMode = 'proposal' | 'itinerary';

/** Pasos del editor. 'preview' no es una pestaña visible: es la vista previa de página completa (?step=preview). */
export type BuilderStep = 'client-trip' | 'cover' | 'journey' | 'pricing' | 'travel-tips' | 'terms' | 'assistant' | 'preview';

/**
 * Los Itinerarios todavía no tienen soporte en la base de datos (falta distinguirlos de una propuesta con `kind`), así que
 * su lista no podría mostrar datos correctos. Hasta entonces el código está listo pero el modo no se ofrece en ninguna parte
 * (ni menú, ni rutas). Se cambia a `true` junto con la migración de `kind`.
 */
export const ITINERARIES_ENABLED = false;

export interface TravelFeatures {
  itinerariesEnabled: boolean;
}

/** Inyectable para que las pruebas (y una futura bandera remota) puedan cambiarlo sin tocar la constante. */
export const TRAVEL_FEATURES = new InjectionToken<TravelFeatures>('TRAVEL_FEATURES', {
  providedIn: 'root',
  factory: () => ({ itinerariesEnabled: ITINERARIES_ENABLED })
});

export function isTravelModeEnabled(mode: TravelMode, features: TravelFeatures): boolean {
  return mode === 'proposal' || features.itinerariesEnabled;
}

export interface TravelTabDef {
  key: Exclude<BuilderStep, 'preview'>;
  label: string;
  /** Permiso adicional para ver la pestaña (además del permiso general de ver/editar del modo). */
  permission?: PermissionCode;
}

/** Qué puede hacer cada modo. Cada bandera gobierna una pieza concreta de la interfaz. */
export interface TravelCapabilities {
  /** Publicar, despublicar, enviar al cliente, checklist de publicación y menú de enlace/WhatsApp. */
  publish: boolean;
  pricing: boolean;
  terms: boolean;
  /** Sección «Acceso privado» (activar/desactivar el acceso protegido del cliente). */
  privateAccess: boolean;
  /** Código de acceso dentro del acceso privado. */
  accessCode: boolean;
  /** Fecha de expiración (opcional) del acceso del cliente. */
  expiration: boolean;
  /** Aceptación contractual del cliente (banner de «aceptada»). */
  accept: boolean;
  /** Selección de servicios del cliente («Sí, por favor»): interacción comercial de propuesta. */
  serviceChoices: boolean;
  /** Comentarios de cotización del cliente por servicio. */
  quoteComments: boolean;
  /** Dar acceso/compartir con el cliente SIN publicación comercial (futuro; sin acción real en Fase 1). */
  shareAccess: boolean;
  documents: boolean;
  aiAssistant: boolean;
  pdfImport: boolean;
  /** El modo tiene vista privada del cliente (hoy solo la propuesta; la de itinerario se diseña en Fase 2). */
  preview: boolean;
  /** Columna y página de vista previa DENTRO del builder (renderiza la vista contractual de propuesta). */
  previewPanel: boolean;
  /** Correo del cliente: solo tiene sentido si algo se le envía. */
  clientEmail: boolean;
}

export interface TravelLabels {
  /** «Propuestas» — título de la lista y del breadcrumb. */
  plural: string;
  /** «propuesta» (minúscula, para frases). */
  singular: string;
  /** «Nueva propuesta». */
  create: string;
  createTitle: string;
  subtitle: string;
  empty: string;
  emptyFiltered: string;
  edit: string;
  deleteTitle: string;
  deleteConfirm: (clientName: string) => string;
  deleteError: string;
}

export interface TravelModeConfig {
  mode: TravelMode;
  /** Ruta base del modo, sin barra final: '/viajes/propuestas'. */
  routeBase: string;
  labels: TravelLabels;
  tabs: TravelTabDef[];
  capabilities: TravelCapabilities;
  permissions: {
    view: PermissionCode;
    create: PermissionCode;
    edit: PermissionCode;
    remove: PermissionCode;
    documents: PermissionCode;
  };
}

export const TRAVEL_CONFIG: Record<TravelMode, TravelModeConfig> = {
  proposal: {
    mode: 'proposal',
    routeBase: '/viajes/propuestas',
    labels: {
      plural: 'Propuestas',
      singular: 'propuesta',
      create: 'Nueva propuesta',
      createTitle: 'Nueva propuesta',
      subtitle: 'Crea y gestiona propuestas personalizadas para tus clientes.',
      empty: 'Todavía no hay propuestas.',
      emptyFiltered: 'No hay propuestas que coincidan con estos filtros.',
      edit: 'Editar propuesta',
      deleteTitle: 'Eliminar propuesta',
      deleteConfirm: (client) => `¿Eliminar la propuesta de ${client}? Esta acción no se puede deshacer.`,
      deleteError: 'No se pudo eliminar la propuesta. Inténtalo nuevamente.'
    },
    tabs: [
      { key: 'client-trip', label: 'Client & Trip' },
      { key: 'cover', label: 'Portada' },
      { key: 'journey', label: 'Itinerario' },
      { key: 'pricing', label: 'Precios', permission: 'propuestas.gestionar_precios' },
      { key: 'travel-tips', label: 'Travel Tips' },
      { key: 'terms', label: 'Términos', permission: 'propuestas.gestionar_terminos' },
      { key: 'assistant', label: 'The Edit Assistant' }
    ],
    capabilities: {
      publish: true,
      shareAccess: false,
      pricing: true,
      terms: true,
      privateAccess: true,
      accessCode: true,
      expiration: true,
      accept: true,
      serviceChoices: true,
      quoteComments: true,
      documents: true,
      aiAssistant: true,
      pdfImport: true,
      preview: true,
      previewPanel: true,
      clientEmail: true
    },
    permissions: {
      view: 'propuestas.ver',
      create: 'propuestas.crear',
      edit: 'propuestas.editar',
      remove: 'propuestas.eliminar',
      documents: 'propuestas.gestionar_documentos'
    }
  },
  itinerary: {
    mode: 'itinerary',
    routeBase: '/viajes/itinerarios',
    labels: {
      plural: 'Itinerarios',
      singular: 'itinerario',
      create: 'Nuevo itinerario',
      createTitle: 'Nuevo itinerario',
      subtitle: 'Arma itinerarios de viaje para tus clientes, sin precios ni condiciones contractuales.',
      empty: 'Todavía no hay itinerarios.',
      emptyFiltered: 'No hay itinerarios que coincidan con estos filtros.',
      edit: 'Editar itinerario',
      deleteTitle: 'Eliminar itinerario',
      deleteConfirm: (client) => `¿Eliminar el itinerario de ${client}? Esta acción no se puede deshacer.`,
      deleteError: 'No se pudo eliminar el itinerario. Inténtalo nuevamente.'
    },
    // Fase 1: datos del viaje (cliente simplificado), portada, itinerario, tips y asistente. Sin precios ni términos.
    tabs: [
      { key: 'client-trip', label: 'Datos del viaje' },
      { key: 'cover', label: 'Portada' },
      { key: 'journey', label: 'Itinerario' },
      { key: 'travel-tips', label: 'Travel Tips' },
      { key: 'assistant', label: 'The Edit Assistant' }
    ],
    // Itinerario = viaje confirmado/operativo: privado (código, expiración, documentos) pero sin nada comercial/contractual.
    capabilities: {
      publish: false,
      // «Compartir / Dar acceso al cliente»: capacidad separada de la publicación comercial. Sin acción real hasta la Fase 2.
      shareAccess: true,
      pricing: false,
      terms: false,
      privateAccess: true,
      accessCode: true,
      expiration: true,
      accept: false,
      serviceChoices: false,
      quoteComments: false,
      documents: true,
      aiAssistant: true,
      pdfImport: false,
      // Tendrá vista privada propia (portada, resumen, itinerario, documentos, Travel Tips). La de propuesta NO se reutiliza.
      preview: true,
      previewPanel: false,
      clientEmail: true
    },
    permissions: {
      view: 'itinerarios.ver',
      create: 'itinerarios.crear',
      edit: 'itinerarios.editar',
      remove: 'itinerarios.eliminar',
      documents: 'itinerarios.gestionar_documentos'
    }
  }
};

export function travelConfigOf(mode: TravelMode): TravelModeConfig {
  return TRAVEL_CONFIG[mode];
}

/** Rutas (para routerLink / navigate) de un modo. Un solo lugar: ningún componente escribe '/proposals' a mano. */
export const travelPaths = {
  list: (mode: TravelMode) => travelConfigOf(mode).routeBase,
  create: (mode: TravelMode) => `${travelConfigOf(mode).routeBase}/new`,
  import: (mode: TravelMode) => `${travelConfigOf(mode).routeBase}/import`,
  /** Para `[routerLink]` / `router.navigate`. */
  edit: (mode: TravelMode, id: string): string[] => [travelConfigOf(mode).routeBase, id, 'edit']
};

/** Modo de la ruta activa (`data.mode`); 'proposal' por defecto (también para las rutas antiguas). */
export function injectTravelMode(): TravelMode {
  const mode = inject(ActivatedRoute).snapshot?.data?.['mode'];
  return mode === 'itinerary' ? 'itinerary' : 'proposal';
}
