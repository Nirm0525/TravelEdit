import { Database } from './database.types';
import { LeadEmailStatus, LeadOrigin, LeadStatus, ProposalEmailStatus } from './lead-enums';
import { LeadTripDetails, toLeadTripDetails } from './lead-trip-details';
import { sanitizeEmailError } from '../utils/sanitize-email-error';

type LeadRow = Database['public']['Tables']['leads']['Row'];
type LeadNoteRow = Database['public']['Tables']['lead_notes']['Row'];

export interface Lead {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  destinationInterestId: string | null;
  destinationInterestText: string | null;
  origin: LeadOrigin;
  message: string | null;
  details: LeadTripDetails;
  status: LeadStatus;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  emailStatus: LeadEmailStatus;
  emailSentAt: string | null;
  emailError: string | null;
  proposalSubject: string | null;
  proposalMessage: string | null;
  proposalSentAt: string | null;
  proposalSentBy: string | null;
  proposalEmailStatus: ProposalEmailStatus | null;
  proposalEmailError: string | null;
}

export interface LeadNote {
  id: string;
  leadId: string;
  authorId: string;
  body: string;
  createdAt: string;
}

export function toLead(row: LeadRow): Lead {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    destinationInterestId: row.destination_interest_id,
    destinationInterestText: row.destination_interest_text,
    origin: row.origin,
    message: row.message,
    details: toLeadTripDetails(row.details),
    status: row.status,
    assignedTo: row.assigned_to,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    emailStatus: row.email_status,
    emailSentAt: row.email_sent_at,
    emailError: sanitizeEmailError(row.email_error),
    proposalSubject: row.proposal_subject,
    proposalMessage: row.proposal_message,
    proposalSentAt: row.proposal_sent_at,
    proposalSentBy: row.proposal_sent_by,
    proposalEmailStatus: row.proposal_email_status,
    proposalEmailError: sanitizeEmailError(row.proposal_email_error)
  };
}

export function toLeadNote(row: LeadNoteRow): LeadNote {
  return {
    id: row.id,
    leadId: row.lead_id,
    authorId: row.author_id,
    body: row.body,
    createdAt: row.created_at
  };
}
