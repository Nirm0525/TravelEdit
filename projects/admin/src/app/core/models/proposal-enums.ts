/** Tipo de registro de «Viajes» (proposals.kind, migración 0055). La base es la fuente de verdad; la ruta solo lo anticipa. */
export type TravelKind = 'proposal' | 'itinerary';

/**
 * Estados de ambos tipos. Propuesta: draft · published · viewed · accepted · expired. Itinerario: draft · shared · viewed
 * (shared llega con 0056: todavía no hay forma de compartir un itinerario desde el panel).
 */
export type ProposalStatus = 'draft' | 'shared' | 'published' | 'viewed' | 'accepted' | 'expired';

/** Estados que existen para cada tipo (en el orden de los filtros). Nunca se mezclan en listas ni conteos. */
export const TRAVEL_STATUSES: Record<TravelKind, readonly ProposalStatus[]> = {
  proposal: ['draft', 'published', 'viewed', 'accepted', 'expired'],
  itinerary: ['draft', 'shared', 'viewed']
};

// No existe un estado "ready" persistido a propósito: si una propuesta está
// completa para publicar es una condición calculada (ver publish_proposal()
// en supabase/migrations/0032_proposals_admin_rpc.sql), no una columna que
// haya que mantener sincronizada cada vez que se edita el contenido.
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Borrador',
  shared: 'Compartido',
  published: 'Publicada',
  viewed: 'Vista por el cliente',
  accepted: 'Aceptada',
  expired: 'Expirada'
};

/** Etiqueta de un estado según el tipo (el itinerario habla de «compartido» y «visto», la propuesta de «publicada»). */
export function statusLabelOf(kind: TravelKind, status: ProposalStatus): string {
  if (kind === 'itinerary' && status === 'viewed') {
    return 'Visto por el cliente';
  }
  return PROPOSAL_STATUS_LABEL[status];
}

export type ProposalServiceType = 'hotel' | 'activity' | 'transfer' | 'flight' | 'other';

export const PROPOSAL_SERVICE_TYPE_LABEL: Record<ProposalServiceType, string> = {
  hotel: 'Hotel',
  activity: 'Actividad',
  transfer: 'Traslado',
  flight: 'Vuelo',
  other: 'Otro'
};

// Resultado de verify_proposal_access() (supabase/migrations/0035_proposal_access_credentials.sql).
// El backend nunca lanza una excepción de Postgres para estos casos — son
// estados normales de UI, no errores a capturar con try/catch.
export type ProposalAccessResult = 'ok' | 'not_found' | 'access_not_configured' | 'locked' | 'invalid_code';
