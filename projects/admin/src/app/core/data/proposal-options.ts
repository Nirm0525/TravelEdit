import { ProposalServiceType, ProposalStatus, TRAVEL_STATUSES, TravelKind, statusLabelOf } from '../models/proposal-enums';

export const PROPOSAL_STATUS_OPTIONS: ReadonlyArray<{ value: ProposalStatus; label: string }> = [
  { value: 'draft', label: 'Borrador' },
  { value: 'published', label: 'Publicada' },
  { value: 'viewed', label: 'Vista por el cliente' },
  { value: 'accepted', label: 'Aceptada' },
  { value: 'expired', label: 'Expirada' }
];

/** Chips de filtro por estado de cada tipo: solo los estados que ese tipo tiene. */
export function statusOptionsFor(kind: TravelKind): ReadonlyArray<{ value: ProposalStatus; label: string }> {
  return TRAVEL_STATUSES[kind].map((value) => ({ value, label: statusLabelOf(kind, value) }));
}

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
