// Interpretación del resultado de private.claim_proposal_import().
//
// La función devuelve una fila compuesta (public.proposal_imports). Cuando NO toma el
// bloqueo devuelve null, y `select * from private.claim_proposal_import(...)` produce
// entonces UNA fila con todas las columnas en null — no cero filas. Por eso el bloqueo
// se considera fallido cuando `id` es null (o cuando no hay filas, por si el cliente de
// Postgres cambia esa forma), nunca solo por rows.length === 0.
import type { ImportRow } from './handler.ts';

export type ClaimRow = Record<string, unknown>;

export function claimedRowOrNull(rows: readonly ClaimRow[]): ImportRow | null {
  const row = rows[0];
  if (!row || row.id == null) {
    return null;
  }
  return row as unknown as ImportRow;
}
