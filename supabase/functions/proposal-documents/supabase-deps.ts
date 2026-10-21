// Dependencias reales de proposal-documents: todo con service_role y consultas explícitas (sin funciones SECURITY DEFINER).
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SERVICE_FILES_BUCKET } from '../_shared/service-attachment-rules.ts';
import type { Deps, ProposalRow, SessionRow, VisibleAttachment } from './handler.ts';

const COLUMNS = 'id, service_id, file_name, mime_type, storage_path';

export function createRealDeps(): Deps {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const table = () => admin.from('proposal_service_attachments');

  return {
    env: (name) => Deno.env.get(name),

    async getSession(sessionId) {
      const { data } = await admin.from('proposal_access_sessions').select('proposal_id, expires_at').eq('id', sessionId).maybeSingle();
      return (data as SessionRow | null) ?? null;
    },

    async getProposal(proposalId) {
      const { data } = await admin.from('proposals').select('id, kind, public_token, status, expires_at, content').eq('id', proposalId).maybeSingle();
      return (data as ProposalRow | null) ?? null;
    },

    async listVisible(proposalId) {
      const { data, error } = await table().select(COLUMNS).eq('proposal_id', proposalId).eq('visible_to_client', true).order('created_at');
      if (error) {
        throw new Error(error.message);
      }
      return (data as VisibleAttachment[]) ?? [];
    },

    async getVisible(proposalId, attachmentId) {
      const { data } = await table().select(COLUMNS).eq('id', attachmentId).eq('proposal_id', proposalId).eq('visible_to_client', true).maybeSingle();
      return (data as VisibleAttachment | null) ?? null;
    },

    async createSignedUrl(path, ttlSeconds, downloadName) {
      const { data, error } = await admin.storage.from(SERVICE_FILES_BUCKET).createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
      if (error || !data) {
        throw new Error(error?.message ?? 'signed url');
      }
      return data.signedUrl;
    },

    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };
}
