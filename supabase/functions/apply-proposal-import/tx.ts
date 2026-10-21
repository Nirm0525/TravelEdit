// Transacción que aplica una importación (modo "new"): marca la importación como aplicada, crea la
// propuesta en borrador y enlaza ambas — todo o nada. Parámetros siempre de la plantilla; nunca
// sql.unsafe ni texto del PDF concatenado en el SQL.
import type { RetentionSummary } from '../_shared/import-summary.ts';
import type { MappedProposal } from '../_shared/proposal-mapping.ts';

/** Forma mínima de postgres.js que usa este módulo (permite probarlo con otro cliente). */
// deno-lint-ignore no-explicit-any
export type TxSql = ((strings: TemplateStringsArray, ...values: any[]) => Promise<any[]>) & {
  /**
   * Parámetro jsonb de postgres.js: recibe el OBJETO y el driver lo serializa una sola vez. No se le pasa un
   * JSON.stringify(...) ni siquiera con `::jsonb`: el driver volvería a serializarlo y la columna quedaría como string JSON.
   */
  json(value: unknown): unknown;
};
export interface SqlLike extends TxSql {
  begin<T>(fn: (tx: TxSql) => Promise<T>): Promise<T>;
}

export const ORIGIN_CHANNELS = ['web', 'whatsapp', 'email', 'phone', 'referral', 'other'] as const;
export type OriginChannel = (typeof ORIGIN_CHANNELS)[number];

export interface ApplyArgs {
  importId: string;
  userId: string;
  originChannel: OriginChannel;
  leadId: string | null;
  mapped: MappedProposal;
  /** Resumen sin datos personales que reemplaza a `extracted` al aplicar (y `diff` pasa a null). */
  retained: RetentionSummary;
}

class ConflictError extends Error {}

/**
 * @returns el id de la propuesta creada, o 'conflict' si la importación ya no estaba en 'ready'
 * (otra pestaña la aplicó primero). Cualquier otro fallo lanza y la transacción se revierte entera:
 * la importación sigue en 'ready'.
 */
export async function applyImportTx(sql: SqlLike, args: ApplyArgs): Promise<string | 'conflict'> {
  const { importId, userId, originChannel, leadId, mapped, retained } = args;
  try {
    return await sql.begin(async (tx) => {
      // Que auth.uid() sea la asesora dentro de la transacción: así la auditoría y los triggers
      // (enforce_proposal_advisor, log_proposal_created) la ven como autora, no como un proceso anónimo.
      await tx`select set_config('request.jwt.claim.sub', ${userId}, true),
                      set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: 'authenticated' })}, true)`;

      const applied = await tx`
        update public.proposal_imports
           set status = 'applied', applied_at = now(),
               extracted = ${tx.json(retained)}::jsonb, diff = null
         where id = ${importId}::uuid and mode = 'new' and status = 'ready'
        returning id`;
      if (applied.length === 0) {
        throw new ConflictError();
      }

      // `kind` va explícito (no se confía en el DEFAULT): la importación de PDF es EXCLUSIVA de Propuestas y nunca debe
      // poder crear un itinerario. Requiere la migración 0055 (columna `kind`) aplicada ANTES de desplegar esta función.
      const inserted = await tx`
        insert into public.proposals (
          kind, status, client_name, client_email, client_phone, destination_text, start_date, end_date,
          travelers_count, currency, advisor_id, created_by, origin_channel, lead_id, content
        ) values (
          'proposal', 'draft', ${mapped.clientName}, ${mapped.clientEmail}, ${mapped.clientPhone}, ${mapped.destinationText},
          ${mapped.startDate}::date, ${mapped.endDate}::date, ${mapped.travelersCount}::int, ${mapped.currency},
          ${userId}::uuid, ${userId}::uuid, ${originChannel}, ${leadId}::uuid, ${tx.json(mapped.content)}::jsonb
        )
        returning id`;
      const proposalId = String(inserted[0].id);

      await tx`update public.proposal_imports set proposal_id = ${proposalId}::uuid where id = ${importId}::uuid`;
      return proposalId;
    });
  } catch (err) {
    if (err instanceof ConflictError) {
      return 'conflict';
    }
    throw err;
  }
}
