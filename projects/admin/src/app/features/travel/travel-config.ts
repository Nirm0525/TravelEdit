import { InjectionToken, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import type { PermissionCode } from '../../core/data/permissions';
import type { TravelKind } from '../../core/models/proposal-enums';

/**
 * Módulo padre «Viajes»: Propuestas e Itinerarios comparten el mismo builder y la misma lista; lo que cambia por modo
 * vive AQUÍ, en una sola configuración, para no repartir `if (mode === …)` por todo el código.
 */
export type TravelMode = TravelKind;

/** Pasos del editor. 'preview' no es una pestaña visible: es la vista previa de página completa (?step=preview). */
export type BuilderStep = 'client-trip' | 'cover' | 'journey' | 'pricing' | 'travel-tips' | 'terms' | 'assistant' | 'preview';

/**
 * La base ya distingue los tipos (proposals.kind, migración 0055) y el panel filtra por `kind` en cada consulta, así que
 * Itinerarios ya funciona de punta a punta en borrador. Sigue apagado hasta que exista el flujo de compartir (0056): con el
 * flag en `false` el modo no se ofrece en ninguna parte (ni menú, ni rutas). Es el ÚNICO cambio que activa Itinerarios.
 */
export const ITINERARIES_ENABLED = true;

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
  /** Compartir con el cliente SIN publicación comercial: «Compartir itinerario», «Dejar de compartir», copiar enlace, WhatsApp y correo. */
  shareAccess: boolean;
  documents: boolean;
  aiAssistant: boolean;
  pdfImport: boolean;
  /** El modo tiene vista privada del cliente (hoy solo la propuesta; la de itinerario se diseña en Fase 2). */
  preview: boolean;
  /** Columna y página de vista previa DENTRO del builder. Qué se pinta lo decide `previewMode` (nunca la de propuesta en un itinerario). */
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
  /** Botón de la lista y título de la ruta de importación: «Nueva desde PDF» / «Nuevo desde PDF». */
  importButton: string;
  importTitle: string;
  importIntro: string;
  importNotesHint: string;
  importGeneralHint: string;
  importCreate: string;
  importCreateError: string;
  /** «No se pudo crear la propuesta…»: el artículo cambia con el género, por eso va como frase completa. */
  createError: string;
}

/**
 * Qué vista previa pinta el builder: 'proposal' = la contractual (inversión, términos, aceptar); 'itinerary' = solo contenido
 * operativo (portada, bienvenida, días, servicios, documentos y Travel Tips). Se comparte el mismo componente, con otro modo.
 */
export type PreviewMode = TravelMode;

export interface TravelModeConfig {
  mode: TravelMode;
  previewMode: PreviewMode;
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
    /** Publicar (propuesta) o compartir (itinerario): la acción que entrega el viaje al cliente. */
    share: PermissionCode;
    documents: PermissionCode;
  };
}

export const TRAVEL_CONFIG: Record<TravelMode, TravelModeConfig> = {
  proposal: {
    mode: 'proposal',
    previewMode: 'proposal',
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
      deleteError: 'No se pudo eliminar la propuesta. Inténtalo nuevamente.',
      importButton: 'Nueva desde PDF',
      importTitle: 'Nueva propuesta desde PDF',
      importIntro:
        'Sube el PDF del viaje y The Edit Assistant leerá los datos del cliente, el itinerario y los precios. Verás lo que encontró antes de crear la propuesta en borrador.',
      importNotesHint: 'Estas notas se agregarán como consejos de viaje en la propuesta.',
      importGeneralHint:
        'Información detectada en el PDF. Revísala antes de crear la propuesta; actualmente no se incorpora automáticamente al borrador.',
      importCreate: 'Crear propuesta en borrador',
      importCreateError: 'No se pudo crear la propuesta. Inténtalo de nuevo.',
      createError: 'No se pudo crear la propuesta. Intenta de nuevo.'
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
      share: 'propuestas.publicar',
      documents: 'propuestas.gestionar_documentos'
    }
  },
  itinerary: {
    mode: 'itinerary',
    previewMode: 'itinerary',
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
      deleteError: 'No se pudo eliminar el itinerario. Inténtalo nuevamente.',
      importButton: 'Nuevo desde PDF',
      importTitle: 'Nuevo itinerario desde PDF',
      importIntro:
        'Sube el PDF del viaje y The Edit Assistant leerá los datos del cliente, el recorrido día a día y los servicios. Verás lo que encontró antes de crear el itinerario en borrador. Los precios y las condiciones del PDF no se importan.',
      importNotesHint: 'Estas notas se agregarán como consejos de viaje en el itinerario.',
      importGeneralHint:
        'Información detectada en el PDF. Revísala antes de crear el itinerario; actualmente no se incorpora automáticamente al borrador.',
      importCreate: 'Crear itinerario en borrador',
      importCreateError: 'No se pudo crear el itinerario. Inténtalo de nuevo.',
      createError: 'No se pudo crear el itinerario. Intenta de nuevo.'
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
      // «Compartir / Dar acceso al cliente»: capacidad separada de la publicación comercial (share_itinerary / unshare_itinerary, 0056).
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
      // Importa solo contenido operativo (el servidor descarta precios y condiciones): ver supabase/functions/_shared/travel-kind.ts.
      pdfImport: true,
      // Vista previa propia dentro del builder (previewMode 'itinerary'): sin inversión, términos ni aceptación. La vista privada
      // del cliente (con compartir) llega con 0056.
      preview: true,
      previewPanel: true,
      clientEmail: true
    },
    permissions: {
      view: 'itinerarios.ver',
      create: 'itinerarios.crear',
      edit: 'itinerarios.editar',
      remove: 'itinerarios.eliminar',
      share: 'itinerarios.compartir',
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
