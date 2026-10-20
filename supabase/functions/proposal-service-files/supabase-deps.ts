// Dependencias reales de proposal-service-files: supabase-js con el JWT del usuario para lo que decide RLS
// (leer/actualizar la propuesta) y service_role para Storage y para la tabla de adjuntos. La lógica vive en handler.ts.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { inspectObjectAtUrl } from '../_shared/object-inspect.ts';
import { SERVICE_FILES_BUCKET } from '../_shared/service-attachment-rules.ts';
import type { AttachmentRow, Deps, InsertResult, ProposalForUser } from './handler.ts';

const TABLE = 'proposal_service_attachments';

export function createRealDeps(): Deps {
  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const userClient = (token: string): SupabaseClient =>
    createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const bucket = () => admin.storage.from(SERVICE_FILES_BUCKET);
  const table = () => admin.from(TABLE);

  const fail = (what: string, error: { message: string } | null): never => {
    throw new Error(`${what}: ${error?.message ?? 'error desconocido'}`);
  };

  return {
    env: (name) => Deno.env.get(name),

    async getUser(token) {
      const { data, error } = await userClient(token).auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },

    async canManageProposals(token) {
      const { data } = await userClient(token).rpc('can_manage_proposals');
      return data === true;
    },

    async getProposalAsUser(token, proposalId) {
      const { data } = await userClient(token).from('proposals').select('id, content, updated_at').eq('id', proposalId).maybeSingle();
      return (data as ProposalForUser | null) ?? null;
    },

    async updateContentAsUser(token, proposalId, expectedUpdatedAt, content) {
      const { data, error } = await userClient(token)
        .from('proposals')
        .update({ content })
        .eq('id', proposalId)
        .eq('updated_at', expectedUpdatedAt)
        .select('id, content, updated_at');
      if (error) {
        return fail('update content', error);
      }
      return ((data as ProposalForUser[] | null) ?? [])[0] ?? null;
    },

    async isAdmin(userId) {
      const { data } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle();
      return (data as { role?: string } | null)?.role === 'admin';
    },

    async getAttachment(id) {
      const { data } = await table().select('*').eq('id', id).maybeSingle();
      return (data as AttachmentRow | null) ?? null;
    },

    async findByPath(path) {
      const { data } = await table().select('*').eq('storage_path', path).maybeSingle();
      return (data as AttachmentRow | null) ?? null;
    },

    async listForServices(proposalId, serviceIds) {
      const { data, error } = await table().select('*').eq('proposal_id', proposalId).in('service_id', serviceIds).order('created_at');
      if (error) {
        return fail('list attachments', error);
      }
      return (data as AttachmentRow[]) ?? [];
    },

    async listForProposal(proposalId) {
      const { data, error } = await table().select('*').eq('proposal_id', proposalId).order('created_at');
      if (error) {
        return fail('list attachments', error);
      }
      return (data as AttachmentRow[]) ?? [];
    },

    async insertAttachment(row): Promise<InsertResult> {
      const { data, error } = await table().insert(row).select('*').single();
      if (error) {
        if (error.code === '23505') {
          return { error: 'duplicate_path' };
        }
        if (error.code === 'P0002' || error.message.includes('service_not_found')) {
          return { error: 'service_not_found' };
        }
        if (error.code === '54000' || error.message.includes('too_many_files')) {
          return { error: 'too_many_files' };
        }
        return fail('insert attachment', error);
      }
      return { row: data as AttachmentRow };
    },

    async replaceFile(id, expectedPath, patch) {
      const { data, error } = await table().update(patch).eq('id', id).eq('storage_path', expectedPath).select('*');
      if (error) {
        return fail('replace attachment', error);
      }
      return ((data as AttachmentRow[] | null) ?? [])[0] ?? null;
    },

    async setVisible(id, visible) {
      const { data, error } = await table().update({ visible_to_client: visible }).eq('id', id).select('*');
      if (error) {
        return fail('set visibility', error);
      }
      return ((data as AttachmentRow[] | null) ?? [])[0] ?? null;
    },

    async deleteRow(id) {
      const { error } = await table().delete().eq('id', id);
      if (error) {
        fail('delete attachment', error);
      }
    },

    async createSignedUploadUrl(path) {
      // upsert: false explícito: la subida firmada falla si el objeto ya existe (nunca pisa un archivo).
      const { data, error } = await bucket().createSignedUploadUrl(path, { upsert: false });
      if (error || !data) {
        return fail('signed upload url', error);
      }
      return { token: data.token, signedUrl: data.signedUrl };
    },

    async inspectObject(path, headBytes) {
      // Una URL firmada de 60 s y UNA petición Range: tamaño real (Content-Range) y primeros bytes (ver _shared/object-inspect.ts).
      const { data, error } = await bucket().createSignedUrl(path, 60);
      if (error || !data) {
        // Storage no firma un objeto que no existe ("Object not found").
        return /not.?found/i.test(error?.message ?? '') ? { status: 'missing' } : { status: 'error', reason: error?.message ?? 'signed url' };
      }
      return inspectObjectAtUrl(data.signedUrl, headBytes);
    },

    async removeObject(path) {
      const { error } = await bucket().remove([path]);
      if (error) {
        fail('remove object', error);
      }
    },

    async createSignedUrl(path, ttlSeconds, downloadName) {
      const { data, error } = await bucket().createSignedUrl(path, ttlSeconds, downloadName ? { download: downloadName } : undefined);
      if (error || !data) {
        return fail('signed url', error);
      }
      return data.signedUrl;
    },

    log: (message, meta) => console.log(JSON.stringify({ msg: message, ...meta }))
  };
}
