import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { handleRequest, MAX_CONCURRENT_PER_USER, MAX_PER_DAY_PER_USER, type Deps, type ImportRow } from './handler.ts';
import { extraction, matchingExtraction, proposalSnapshot } from '../_shared/test-fixtures.ts';
import type { Extraction, StoredExtraction } from '../_shared/proposal-extraction.ts';
import type { ProposalDiff } from '../_shared/proposal-diff.ts';

const USER = '11111111-1111-1111-1111-111111111111';
const IMPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const PROPOSAL = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PATH = `${USER}/cccccccc-cccc-cccc-cccc-cccccccccccc.pdf`;

const row = (over: Partial<ImportRow> = {}): ImportRow => ({
  id: IMPORT_ID,
  proposal_id: null,
  file_path: PATH,
  mode: 'new',
  status: 'uploaded',
  created_by: USER,
  ...over
});

function validPdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
}

interface Harness {
  deps: Deps;
  tasks: Promise<unknown>[];
  ready: { id: string; extracted: StoredExtraction; diff: ProposalDiff | null }[];
  failed: { id: string; message: string }[];
  logs: string[];
  extractCalls: number;
}

function harness(over: Partial<Deps> = {}, importRow: ImportRow | null = row()): Harness {
  let locked = false;
  const h: Harness = { tasks: [], ready: [], failed: [], logs: [], extractCalls: 0, deps: undefined as unknown as Deps };
  h.deps = {
    env: (name) => ({ ANTHROPIC_API_KEY: 'sk-test', ANTHROPIC_MODEL: 'claude-sonnet-5-5' } as Record<string, string>)[name],
    getUser: (token) => Promise.resolve(token === 'good' ? { id: USER } : null),
    getImportAsUser: () => Promise.resolve(importRow),
    canEditProposal: () => Promise.resolve(true),
    countProcessing: () => Promise.resolve(0),
    countSince: () => Promise.resolve(1),
    lockImport: () => {
      if (locked || !importRow || !['uploaded', 'failed'].includes(importRow.status)) {
        return Promise.resolve(null);
      }
      locked = true;
      return Promise.resolve({ ...importRow, status: 'processing' });
    },
    objectOwner: () => Promise.resolve({ ownerId: USER }),
    download: () => Promise.resolve(validPdf()),
    getProposalSnapshot: () => Promise.resolve(proposalSnapshot()),
    extract: (): Promise<Extraction> => {
      h.extractCalls++;
      return Promise.resolve(matchingExtraction());
    },
    finishReady: (id, patch) => {
      h.ready.push({ id, ...patch });
      return Promise.resolve();
    },
    finishFailed: (id, message) => {
      h.failed.push({ id, message });
      return Promise.resolve();
    },
    runInBackground: (task) => void h.tasks.push(task),
    now: () => new Date('2027-01-10T12:00:00Z'),
    log: (message, meta) => void h.logs.push(JSON.stringify({ message, ...meta })),
    ...over
  };
  return h;
}

const request = (body: unknown = { import_id: IMPORT_ID }, token: string | null = 'good', extra: Record<string, string> = {}) =>
  new Request('https://example.test/functions/v1/import-proposal-pdf', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
    body: JSON.stringify(body)
  });

async function call(h: Harness, req: Request = request()) {
  const res = await handleRequest(req, h.deps);
  await Promise.all(h.tasks);
  return res;
}

Deno.test('401: sin token o con token inválido', async () => {
  const h = harness();
  assertEquals((await call(h, request({ import_id: IMPORT_ID }, null))).status, 401);
  assertEquals((await call(h, request({ import_id: IMPORT_ID }, 'malo'))).status, 401);
});

Deno.test('400: import_id ausente o que no es uuid', async () => {
  const h = harness();
  assertEquals((await call(h, request({}))).status, 400);
  assertEquals((await call(h, request({ import_id: '1; drop table' }))).status, 400);
});

Deno.test('404: import_id ajeno (RLS no devuelve la fila)', async () => {
  const h = harness({}, null);
  const res = await call(h);
  assertEquals(res.status, 404);
  assertEquals(h.ready.length + h.failed.length, 0);
  assertEquals(h.extractCalls, 0);
});

Deno.test('403: modo merge sin permiso de edición sobre la propuesta', async () => {
  const h = harness({ canEditProposal: () => Promise.resolve(false) }, row({ mode: 'merge', proposal_id: PROPOSAL }));
  const res = await call(h);
  assertEquals(res.status, 403);
  assertEquals(h.extractCalls, 0);
});

Deno.test('409: doble llamada — la segunda no procesa de nuevo', async () => {
  const h = harness();
  const first = await call(h);
  assertEquals(first.status, 202);
  const second = await call(h);
  assertEquals(second.status, 409);
  assertEquals(h.extractCalls, 1);
  assertEquals(h.ready.length, 1);
});

Deno.test('409: ya aplicada o ya en proceso', async () => {
  for (const status of ['processing', 'applied', 'ready']) {
    const h = harness({}, row({ status }));
    assertEquals((await call(h)).status, 409, status);
  }
});

Deno.test('reintento: una importación en failed vuelve a procesarse', async () => {
  const h = harness({}, row({ status: 'failed' }));
  assertEquals((await call(h)).status, 202);
  assertEquals(h.ready.length, 1);
});

Deno.test('429: demasiadas importaciones en curso', async () => {
  const h = harness({ countProcessing: () => Promise.resolve(MAX_CONCURRENT_PER_USER) });
  const res = await call(h);
  assertEquals(res.status, 429);
  assertStringIncludes((await res.json()).error, '3');
  assertEquals(h.extractCalls, 0);
});

Deno.test('429: límite diario superado', async () => {
  const h = harness({ countSince: () => Promise.resolve(MAX_PER_DAY_PER_USER + 1) });
  const res = await call(h);
  assertEquals(res.status, 429);
  assertStringIncludes((await res.json()).error, '30');
});

Deno.test('límite diario: exactamente 30 todavía se permite', async () => {
  const h = harness({ countSince: () => Promise.resolve(MAX_PER_DAY_PER_USER) });
  assertEquals((await call(h)).status, 202);
});

Deno.test('202 + modo new: guarda extracted con warnings, sin diff', async () => {
  const h = harness();
  const res = await call(h);
  assertEquals(res.status, 202);
  assertEquals(h.failed.length, 0);
  assertEquals(h.ready[0].diff, null);
  assertEquals(h.ready[0].extracted.warnings, []);
  assertEquals(h.ready[0].extracted.meta.model, 'claude-sonnet-5-5');
});

Deno.test('modo merge: calcula el diff con código y guarda base_updated_at', async () => {
  const h = harness({}, row({ mode: 'merge', proposal_id: PROPOSAL }));
  assertEquals((await call(h)).status, 202);
  const diff = h.ready[0].diff!;
  assertEquals(diff.base_updated_at, '2027-01-05T10:00:00Z');
  assertEquals(diff.summary.services.unchanged, 4);
});

Deno.test('archivo que no es PDF → failed con mensaje en español, sin llamar al modelo', async () => {
  const h = harness({ download: () => Promise.resolve(new TextEncoder().encode('<html>hola</html>')) });
  await call(h);
  assertEquals(h.failed[0].message, 'El archivo no es un PDF válido.');
  assertEquals(h.extractCalls, 0);
  assertEquals(h.ready.length, 0);
});

Deno.test('archivo de más de 20 MB → failed', async () => {
  const big = new Uint8Array(20 * 1024 * 1024 + 1);
  big.set(new TextEncoder().encode('%PDF-1.7'));
  const h = harness({ download: () => Promise.resolve(big) });
  await call(h);
  assertStringIncludes(h.failed[0].message, '20 MB');
});

Deno.test('objeto de otro dueño o inexistente → failed', async () => {
  const other = harness({ objectOwner: () => Promise.resolve({ ownerId: '22222222-2222-2222-2222-222222222222' }) });
  await call(other);
  assertStringIncludes(other.failed[0].message, 'No se pudo verificar el archivo');
  assertEquals(other.extractCalls, 0);

  const missing = harness({ objectOwner: () => Promise.resolve(null) });
  await call(missing);
  assertStringIncludes(missing.failed[0].message, 'No se encontró el archivo');
});

Deno.test('extracción sin contenido útil (PDF ilegible) → failed', async () => {
  const h = harness({ extract: () => Promise.resolve(extraction()) });
  await call(h);
  assertStringIncludes(h.failed[0].message, 'No se encontró información del viaje');
});

Deno.test('falta la API key → failed con mensaje para la asesora; el detalle técnico va al log', async () => {
  const h = harness({ env: () => undefined });
  await call(h);
  assertStringIncludes(h.failed[0].message, 'Avisa al administrador');
  assert(h.logs.some((l) => l.includes('falta ANTHROPIC_API_KEY')));
});

Deno.test('errores inesperados: mensaje genérico, sin detalles técnicos; el log no lleva datos del cliente', async () => {
  const h = harness({
    extract: () => Promise.reject(new Error('boom con detalles internos')),
  });
  await call(h);
  assertEquals(h.failed[0].message, 'No se pudo procesar el PDF. Inténtalo de nuevo en unos minutos.');
  assert(!h.failed[0].message.includes('boom'));
  const logs = h.logs.join('\n');
  assert(!logs.includes('Familia Ejemplo'));
  assert(!logs.includes('sk-test'));
});

Deno.test('CORS: solo el dominio permitido recibe Access-Control-Allow-Origin', async () => {
  const h = harness({ env: (n) => (n === 'ALLOWED_ORIGINS' ? 'https://admin.ejemplo.test' : undefined) });
  const ok = await handleRequest(
    new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://admin.ejemplo.test' } }),
    h.deps
  );
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), 'https://admin.ejemplo.test');
  const bad = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://otro.test' } }), h.deps);
  assertEquals(bad.headers.get('Access-Control-Allow-Origin'), null);
  assert(bad.headers.get('Access-Control-Allow-Origin') !== '*');
});
