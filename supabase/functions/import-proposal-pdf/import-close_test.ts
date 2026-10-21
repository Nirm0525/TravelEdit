import { assert, assertEquals, assertFalse, assertRejects } from 'jsr:@std/assert@1';
import {
  closeImportFailed,
  closeImportReady,
  IMPORT_STATE_CLOSE_CONFLICT,
  ImportCloseConflictError,
  type CloseSql
} from './import-close.ts';
import type { ImportRow } from './handler.ts';
import type { StoredExtraction } from '../_shared/proposal-extraction.ts';
import { matchingExtraction } from '../_shared/test-fixtures.ts';

const IMPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const TOKEN = '2026-10-19 19:58:21.166059+00';

const row = (): ImportRow => ({
  id: IMPORT_ID,
  proposal_id: null,
  file_path: 'u/f.pdf',
  mode: 'new',
  kind: 'proposal',
  status: 'processing',
  created_by: '11111111-1111-1111-1111-111111111111',
  processing_started_at: TOKEN
});

const stored = (): StoredExtraction => ({
  ...matchingExtraction(),
  warnings: [],
  meta: { model: 'gpt-6.1-sol', extracted_at: '2027-01-01T00:00:00Z', usage: undefined } as unknown as StoredExtraction['meta']
});

/** SQL falso: guarda el texto de cada consulta y sus parámetros, y responde con el conteo indicado. */
function fakeSql(count: number | null | undefined) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ text: strings.join('?'), values });
      return Promise.resolve(count === undefined ? {} : { count });
    },
    { json: (value: unknown) => ({ json: value }) }
  ) as unknown as CloseSql;
  return { sql, calls };
}

for (const [name, run] of [
  ['finishReady', (sql: CloseSql) => closeImportReady(sql, row(), { extracted: stored(), diff: null })],
  ['finishFailed', (sql: CloseSql) => closeImportFailed(sql, row(), 'No se pudo procesar el PDF.')]
] as const) {
  Deno.test(`${name}: exactamente 1 fila afectada es éxito`, async () => {
    const { sql, calls } = fakeSql(1);
    await run(sql);
    assertEquals(calls.length, 1);
  });

  Deno.test(`${name}: 0 filas es un error, no un éxito`, async () => {
    const { sql } = fakeSql(0);
    const err = await assertRejects(() => run(sql), ImportCloseConflictError);
    assertEquals([err.code, err.operation, err.importId, err.rowsAffected], [IMPORT_STATE_CLOSE_CONFLICT, name, IMPORT_ID, 0]);
  });

  Deno.test(`${name}: más de 1 fila también es un error (defensivo)`, async () => {
    const { sql } = fakeSql(2);
    const err = await assertRejects(() => run(sql), ImportCloseConflictError);
    assertEquals(err.rowsAffected, 2);
  });

  Deno.test(`${name}: si el driver no informa un conteo (null o undefined) no se puede demostrar la escritura → error`, async () => {
    for (const count of [null, undefined]) {
      const { sql } = fakeSql(count);
      const err = await assertRejects(() => run(sql), ImportCloseConflictError);
      assertEquals(err.rowsAffected, null);
    }
  });

  Deno.test(`${name}: el token viaja como texto (::text::timestamptz) y no como ::timestamptz a secas`, async () => {
    const { sql, calls } = fakeSql(1);
    await run(sql);
    const { text, values } = calls[0];
    assert(text.includes('?::text::timestamptz'), 'el token debe compararse como texto');
    assertFalse(/\?::timestamptz/.test(text), 'el driver recortaría los microsegundos');
    // …y se pasa tal cual lo devolvió el claim, sin reconstruirlo.
    assert(values.includes(TOKEN));
    // Conserva el resto de la guarda: id + status + token.
    assert(text.includes("status = 'processing'") && text.includes('where id = ?::uuid'));
  });

  Deno.test(`${name}: el error de conflicto no lleva datos del cliente ni del PDF`, async () => {
    const { sql } = fakeSql(0);
    const err = await assertRejects(() => run(sql), ImportCloseConflictError);
    const text = `${err.name} ${err.message} ${JSON.stringify(err)}`;
    assertFalse(text.includes('Familia Ejemplo'));
    assertFalse(text.includes('No se pudo procesar'));
    assert(text.includes(IMPORT_ID) && text.includes(IMPORT_STATE_CLOSE_CONFLICT) && text.includes(name));
  });
}
