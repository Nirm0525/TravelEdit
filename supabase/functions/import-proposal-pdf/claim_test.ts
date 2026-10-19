import { assertEquals } from 'jsr:@std/assert@1';
import { claimedRowOrNull } from './claim.ts';

// Forma real (verificada en PGlite) de `select * from private.claim_proposal_import(...)`
// cuando NO se toma el bloqueo: UNA fila con todas las columnas en null.
const ALL_NULL_ROW = {
  id: null,
  proposal_id: null,
  file_path: null,
  mode: null,
  status: null,
  extracted: null,
  diff: null,
  error: null,
  created_by: null,
  created_at: null,
  applied_at: null,
  processing_started_at: null
};

Deno.test('claim: una fila con todo en null (caso 409) no es un bloqueo tomado', () => {
  assertEquals(claimedRowOrNull([ALL_NULL_ROW]), null);
});

Deno.test('claim: cero filas tampoco es un bloqueo tomado', () => {
  assertEquals(claimedRowOrNull([]), null);
});

Deno.test('claim: una fila con id es el bloqueo tomado', () => {
  const row = {
    id: '00000000-0000-0000-0000-000000000002',
    proposal_id: null,
    file_path: 'u/f.pdf',
    mode: 'new',
    status: 'processing',
    created_by: '11111111-1111-1111-1111-111111111111',
    processing_started_at: '2027-01-10 12:00:00.123456+00'
  };
  assertEquals(claimedRowOrNull([row]) as unknown, row as unknown);
});
