import { ProposalServiceType, ProposalStatus } from '../models/proposal-enums';

export const PROPOSAL_STATUS_OPTIONS: ReadonlyArray<{ value: ProposalStatus; label: string }> = [
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicada' },
  { value: 'viewed', label: 'Vista por el cliente' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'expired', label: 'Expirada' }
];

export const PROPOSAL_SERVICE_TYPE_OPTIONS: ReadonlyArray<{ value: ProposalServiceType; label: string }> = [
  { value: 'flight', label: 'Vuelo' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'transfer', label: 'Traslado' },
  { value: 'activity', label: 'Actividad' },
  { value: 'other', label: 'Otro' }
];

export const PROPOSAL_CURRENCY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: 'USD', label: 'USD — Dólar estadounidense' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'HNL', label: 'HNL — Lempira hondureña' }
];
