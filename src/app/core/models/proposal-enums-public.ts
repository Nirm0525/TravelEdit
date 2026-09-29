// Espejo de projects/admin/src/app/core/models/proposal-enums.ts (solo lo
// que el sitio público necesita para renderizar) — apps separadas que
// deliberadamente no comparten código.
import { ProposalServiceType } from './proposal-content.model';

export const PROPOSAL_SERVICE_TYPE_LABEL: Record<ProposalServiceType, string> = {
  hotel: 'Hotel',
  activity: 'Actividad',
  transfer: 'Traslado',
  flight: 'Vuelo',
  other: 'Otro'
};
