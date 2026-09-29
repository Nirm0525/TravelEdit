export type ProposalStatus = 'draft' | 'published' | 'viewed' | 'accepted' | 'expired';

// No existe un estado "ready" persistido a propósito: si una propuesta está
// completa para publicar es una condición calculada (ver publish_proposal()
// en supabase/migrations/0032_proposals_admin_rpc.sql), no una columna que
// haya que mantener sincronizada cada vez que se edita el contenido.
export const PROPOSAL_STATUS_LABEL: Record<ProposalStatus, string> = {
  draft: 'Borrador',
  published: 'Publicada',
  viewed: 'Vista por el cliente',
  accepted: 'Aceptada',
  expired: 'Expirada'
};

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
