import { LeadOrigin, LeadStatus } from '../models/lead-enums';

export const LEAD_STATUS_LABEL: Record<LeadStatus, string> = {
  nueva: 'Nueva',
  contactada: 'Contactada',
  propuesta_enviada: 'Propuesta enviada',
  cerrada_ganada: 'Cerrada — ganada',
  cerrada_perdida: 'Cerrada — perdida'
};

export const LEAD_STATUS_OPTIONS: ReadonlyArray<{ value: LeadStatus; label: string }> = (
  Object.entries(LEAD_STATUS_LABEL) as [LeadStatus, string][]
).map(([value, label]) => ({ value, label }));

export const LEAD_ORIGIN_LABEL: Record<LeadOrigin, string> = {
  formulario_web: 'Formulario web',
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  referido: 'Referido',
  email: 'Correo',
  otro: 'Otro'
};
