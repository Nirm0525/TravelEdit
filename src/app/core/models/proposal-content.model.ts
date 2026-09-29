// Espejo de projects/admin/src/app/core/models/proposal.model.ts (solo la
// parte de `content`) — son apps separadas que deliberadamente no comparten
// código (mismo criterio que lead-trip-details.ts). El sitio público solo
// lee este contenido, nunca lo escribe, así que no duplica los factory
// helpers (createProposalDay, etc.) del lado admin.

export type ProposalServiceType = 'hotel' | 'activity' | 'transfer' | 'flight' | 'other';

export interface ProposalCover {
  title: string;
  subtitle: string;
  imagePath: string | null;
}

export interface ProposalIntro {
  headline: string;
  body: string;
}

export interface ProposalServiceItem {
  id: string;
  type: ProposalServiceType;
  title: string;
  description: string;
  notes: string;
}

export interface ProposalDay {
  id: string;
  dayNumber: number;
  title: string;
  location: string;
  description: string;
  imagePath: string | null;
  services: ProposalServiceItem[];
}

export interface ProposalPricingLine {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
}

export type ProposalFeeLine = ProposalPricingLine;

export interface ProposalPricing {
  lines: ProposalPricingLine[];
  feesLines: ProposalFeeLine[];
}

export interface ProposalTerms {
  title: string;
  body: string;
}

export interface ProposalContent {
  cover: ProposalCover;
  intro: ProposalIntro;
  days: ProposalDay[];
  pricing: ProposalPricing;
  terms: ProposalTerms;
}

function emptyContent(): ProposalContent {
  return {
    cover: { title: '', subtitle: '', imagePath: null },
    intro: { headline: '', body: '' },
    days: [],
    pricing: { lines: [], feesLines: [] },
    terms: { title: '', body: '' }
  };
}

export function toProposalContent(value: unknown): ProposalContent {
  const empty = emptyContent();
  if (!value || typeof value !== 'object') {
    return empty;
  }
  const raw = value as Partial<ProposalContent>;
  return {
    cover: { ...empty.cover, ...raw.cover },
    intro: { ...empty.intro, ...raw.intro },
    days: Array.isArray(raw.days) ? raw.days : [],
    pricing: {
      lines: Array.isArray(raw.pricing?.lines) ? raw.pricing.lines : [],
      feesLines: Array.isArray(raw.pricing?.feesLines) ? raw.pricing.feesLines : []
    },
    terms: { ...empty.terms, ...raw.terms }
  };
}
