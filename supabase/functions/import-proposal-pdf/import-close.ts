// Cierre de una importación: processing → ready | failed.
//
// Solo escribe quien sigue siendo dueño del bloqueo: la fila debe seguir en 'processing' con el mismo
// processing_started_at que devolvió private.claim_proposal_import (un proceso viejo que termina tarde no
// pisa el resultado de quien retomó la importación).
//
// Dos reglas que no se pueden perder:
//  1) El token se compara como texto: `${token}::text::timestamptz`. Con `${token}::timestamptz`, postgres.js
//     ve que el parámetro es un timestamptz, lo pasa por `new Date(...)` y lo serializa con `.toISOString()`:
//     se pierden los microsegundos (…21.166059 llega como …21.166) y el UPDATE no encuentra la fila.
//  2) Exactamente 1 fila afectada es éxito. 0 filas (token ajeno, estado cambiado) o un conteo que no se pueda
//     demostrar es un error: nunca se da por cerrada una importación que no se escribió.
import type { ProposalDiff } from '../_shared/proposal-diff.ts';
import type { StoredExtraction } from '../_shared/proposal-extraction.ts';
import type { ImportRow } from './handler.ts';

export const IMPORT_STATE_CLOSE_CONFLICT = 'IMPORT_STATE_CLOSE_CONFLICT';

export type CloseOperation = 'finishReady' | 'finishFailed';

/** El cierre no escribió exactamente una fila. Sin datos del cliente: solo operación, id y conteo. */
export class ImportCloseConflictError extends Error {
  readonly code = IMPORT_STATE_CLOSE_CONFLICT;

  constructor(
    readonly operation: CloseOperation,
    readonly importId: string,
    /** Filas que informó el driver; null si no informó un número. */
    readonly rowsAffected: number | null
  ) {
    super(`${IMPORT_STATE_CLOSE_CONFLICT}: ${operation} rowsAffected=${rowsAffected} importId=${importId}`);
    this.name = 'ImportCloseConflictError';
  }
}

/** Lo que se usa de postgres.js: la plantilla y `sql.json`; el resultado de un UPDATE expone `count`. */
export interface CloseSql {
  (strings: TemplateStringsArray, ...values: unknown[]): PromiseLike<{ count?: number | null }>;
  json(value: unknown): unknown;
}

function assertOneRow(operation: CloseOperation, importId: string, count: number | null | undefined): void {
  if (count !== 1) {
    throw new ImportCloseConflictError(operation, importId, typeof count === 'number' ? count : null);
  }
}

export async function closeImportReady(
  sql: CloseSql,
  row: ImportRow,
  patch: { extracted: StoredExtraction; diff: ProposalDiff | null }
): Promise<void> {
  const result = await sql`
    update public.proposal_imports
       set status = 'ready',
           extracted = ${sql.json(patch.extracted as never)},
           diff = ${patch.diff ? sql.json(patch.diff as never) : null},
           error = null
     where id = ${row.id}::uuid
       and status = 'processing'
       and processing_started_at = ${row.processing_started_at!}::text::timestamptz`;
  assertOneRow('finishReady', row.id, result.count);
}

export async function closeImportFailed(sql: CloseSql, row: ImportRow, message: string): Promise<void> {
  const result = await sql`
    update public.proposal_imports
       set status = 'failed', error = ${message}
     where id = ${row.id}::uuid
       and status = 'processing'
       and processing_started_at = ${row.processing_started_at!}::text::timestamptz`;
  assertOneRow('finishFailed', row.id, result.count);
}
