import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  DEFAULT_PROCESS_DEADLINE_MS,
  handleRequest,
  MAX_CONCURRENT_PER_USER,
  MAX_PER_DAY_PER_USER,
  type Deps,
  type ImportRow
} from './handler.ts';
import { DEADLINE_MESSAGE } from './openai.ts';
import { UserError } from './pdf.ts';
import { extraction, matchingExtraction, proposalSnapshot } from '../_shared/test-fixtures.ts';
import type { Extraction, StoredExtraction } from '../_shared/proposal-extraction.ts';
import type { ProposalDiff } from '../_shared/proposal-diff.ts';

const NOW = new Date('2027-01-10T12:00:00Z');
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
  processing_started_at: null,
  ...over
});

function validPdf(): Uint8Array {
  return new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF');
}

interface Harness {
  deps: Deps;
  tasks: Promise<unknown>[];
  ready: { id: string; startedAt: string | null | undefined; extracted: StoredExtraction; diff: ProposalDiff | null }[];
  failed: { id: string; startedAt: string | null | undefined; message: string }[];
  logs: string[];
  extractCalls: number;
  extractArgs: { deadlineAt: number; model: string; detail: string; reasoningEffort: string | undefined; maxOutputTokens: number }[];
  countProcessingCalls: string[];
  lockCalls: string[];
}

function harness(over: Partial<Deps> = {}, importRow: ImportRow | null = row()): Harness {
  let locked = false;
  const h: Harness = {
    tasks: [],
    ready: [],
    failed: [],
    logs: [],
    extractCalls: 0,
    extractArgs: [],
    countProcessingCalls: [],
    lockCalls: [],
    deps: undefined as unknown as Deps
  };
  h.deps = {
    env: (name) => ({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-6.1-sol' } as Record<string, string>)[name],
    getUser: (token) => Promise.resolve(token === 'good' ? { id: USER } : null),
    getImportAsUser: () => Promise.resolve(importRow),
    canEditProposal: () => Promise.resolve(true),
    countProcessing: (userId) => {
      h.countProcessingCalls.push(userId);
      return Promise.resolve(0);
    },
    countSince: () => Promise.resolve(1),
    // Simula private.claim_proposal_import: la base decide con su reloj (aquí, el mismo NOW de los tests).
    lockImport: (id) => {
      h.lockCalls.push(id);
      const staleBefore = new Date(NOW.getTime() - 10 * 60_000).toISOString();
      const stale =
        importRow?.status === 'processing' &&
        (importRow.processing_started_at == null || importRow.processing_started_at < staleBefore);
      if (locked || !importRow || !(['uploaded', 'failed'].includes(importRow.status) || stale)) {
        return Promise.resolve(null);
      }
      locked = true;
      return Promise.resolve({ ...importRow, status: 'processing', processing_started_at: NOW.toISOString() });
    },
    objectOwner: () => Promise.resolve({ ownerId: USER }),
    download: () => Promise.resolve(validPdf()),
    getProposalSnapshot: () => Promise.resolve(proposalSnapshot()),
    extract: (args): Promise<Extraction> => {
      h.extractCalls++;
      args.onUsage?.({ attempt: 1, inputTokens: 1200, outputTokens: 800, reasoningTokens: 100 });
      h.extractArgs.push({ deadlineAt: args.deadlineAt, model: args.model, detail: args.detail, reasoningEffort: args.reasoningEffort, maxOutputTokens: args.maxOutputTokens });
      return Promise.resolve(matchingExtraction());
    },
    finishReady: (r, patch) => {
      h.ready.push({ id: r.id, startedAt: r.processing_started_at, ...patch });
      return Promise.resolve();
    },
    finishFailed: (r, message) => {
      h.failed.push({ id: r.id, startedAt: r.processing_started_at, message });
      return Promise.resolve();
    },
    runInBackground: (task) => void h.tasks.push(task),
    now: () => NOW,
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
    // 'processing' reciente: un proceso sin inicio o de más de 10 min se retoma (ver más abajo).
    const h = harness({}, row({ status, processing_started_at: status === 'processing' ? '2027-01-10T11:59:00Z' : null }));
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
  assertEquals(h.ready[0].extracted.meta.model, 'gpt-6.1-sol');
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
  assert(h.logs.some((l) => l.includes('falta OPENAI_API_KEY')));
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

// ---------------------------------------------------------------- 0050: procesos atascados

const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

Deno.test('límite de en curso y bloqueo: la función solo pasa ids; el tiempo lo decide la base', async () => {
  const h = harness();
  await call(h);
  assertEquals(h.countProcessingCalls, [USER]);
  assertEquals(h.lockCalls, [IMPORT_ID]);
  assertEquals(h.ready[0].startedAt, NOW.toISOString()); // el resultado se escribe con el token que devolvió el bloqueo
});

Deno.test('proceso atascado (processing con más de 10 min) se puede retomar', async () => {
  const h = harness({}, row({ status: 'processing', processing_started_at: minutesAgo(11) }));
  assertEquals((await call(h)).status, 202);
  assertEquals(h.ready.length, 1);
});

Deno.test('processing sin inicio registrado también se retoma', async () => {
  const h = harness({}, row({ status: 'processing', processing_started_at: null }));
  assertEquals((await call(h)).status, 202);
});

Deno.test('processing reciente (menos de 10 min) sigue dando 409', async () => {
  const h = harness({}, row({ status: 'processing', processing_started_at: minutesAgo(2) }));
  assertEquals((await call(h)).status, 409);
  assertEquals(h.extractCalls, 0);
});

// ---------------------------------------------------------------- plazo total

Deno.test('plazo: por defecto 140 s, y se le pasa al cliente de OpenAI como instante límite', async () => {
  assertEquals(DEFAULT_PROCESS_DEADLINE_MS, 140_000);
  const h = harness();
  await call(h);
  assertEquals(h.extractArgs[0].deadlineAt, NOW.getTime() + 140_000);
});

Deno.test('plazo: PROCESS_DEADLINE_MS configurable', async () => {
  const h = harness({ env: (n) => ({ OPENAI_API_KEY: 'sk-test', PROCESS_DEADLINE_MS: '60000' } as Record<string, string>)[n] });
  await call(h);
  assertEquals(h.extractArgs[0].deadlineAt, NOW.getTime() + 60_000);
});

Deno.test('plazo alcanzado antes de llamar al modelo → failed con el mensaje de plazo, sin extraer', async () => {
  const h = harness({
    env: (n) => ({ OPENAI_API_KEY: 'sk-test', PROCESS_DEADLINE_MS: '1' } as Record<string, string>)[n],
    now: (() => {
      let calls = 0;
      // La primera lectura es el inicio del proceso; las siguientes ya están pasadas del plazo.
      return () => new Date(NOW.getTime() + (calls++ === 0 ? 0 : 5_000));
    })()
  });
  await processOnly(h);
  assertEquals(h.failed[0].message, DEADLINE_MESSAGE);
  assertEquals(h.extractCalls, 0);
});

Deno.test('plazo alcanzado durante la extracción → failed con el mismo mensaje', async () => {
  const h = harness({ extract: () => Promise.reject(new UserError(DEADLINE_MESSAGE, 'plazo')) });
  await call(h);
  assertEquals(h.failed[0].message, DEADLINE_MESSAGE);
  assertEquals(h.ready.length, 0);
});

async function processOnly(h: Harness): Promise<void> {
  const { processImport } = await import('./handler.ts');
  await processImport(h.deps, row({ status: 'processing', processing_started_at: NOW.toISOString() }));
}

Deno.test('proveedor: la configuración llega a la extracción — valores por defecto', async () => {
  const h = harness();
  await call(h);
  assertEquals(h.extractArgs[0].model, 'gpt-6.1-sol');
  assertEquals(h.extractArgs[0].detail, 'high');
  assertEquals(h.extractArgs[0].reasoningEffort, undefined);
  assertEquals(h.extractArgs[0].maxOutputTokens, 40_000);
});

Deno.test('proveedor: la configuración llega a la extracción — secrets personalizados', async () => {
  const env: Record<string, string> = {
    OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-6-astra', OPENAI_PDF_DETAIL: 'low', OPENAI_REASONING_EFFORT: 'minimal', OPENAI_MAX_OUTPUT_TOKENS: '64000'
  };
  const h = harness({ env: (n) => env[n] });
  await call(h);
  assertEquals(h.extractArgs[0], { deadlineAt: h.extractArgs[0].deadlineAt, model: 'gpt-6-astra', detail: 'low', reasoningEffort: 'minimal', maxOutputTokens: 64_000 });
  assertEquals(h.ready[0].extracted.meta.model, 'gpt-6-astra');
});

Deno.test('proveedor: sin OPENAI_API_KEY falla con el mensaje para la asesora (aunque exista otra clave)', async () => {
  const h = harness({ env: (n) => (n === 'ANTHROPIC_API_KEY' ? 'sk-ant' : undefined) });
  await call(h);
  assertStringIncludes(h.failed[0].message, 'Avisa al administrador');
  assert(h.logs.some((l) => l.includes('falta OPENAI_API_KEY')));
});

// ---------------------------------------------------------------- resumen de la extracción en el log

const summaryLogs = (h: Harness) => h.logs.map((l) => JSON.parse(l)).filter((l) => l.message === 'extraction.summary');

Deno.test('resumen: una línea por extracción con modelo, llamadas, tokens, costo estimado y tiempo', async () => {
  const h = harness();
  await call(h);
  const lines = summaryLogs(h);
  assertEquals(lines.length, 1);
  const line = lines[0];
  assertEquals(line.model, 'gpt-6.1-sol');
  assertEquals([line.calls, line.inputTokens, line.outputTokens, line.reasoningTokens], [1, 1200, 800, 100]);
  assertEquals(line.costUsd, 0.0104); // (1200 × 2 + 800 × 10) / 1 000 000
  assertEquals(typeof line.totalMs, 'number');
  assertEquals(line.importId, IMPORT_ID);
});

Deno.test('resumen: nada del contenido del PDF ni datos del cliente en el log', async () => {
  const h = harness();
  await call(h);
  const all = h.logs.join(String.fromCharCode(10));
  for (const secret of ['Familia Ejemplo', 'ejemplo@correo.test', '+1 555', 'Hotel Savoy', 'JVBERi']) {
    assert(!all.includes(secret), 'no debe aparecer ' + secret);
  }
});

Deno.test('resumen: el mismo resumen queda en extracted.meta.usage (lo lee el panel y se puede consultar en la base)', async () => {
  const h = harness();
  await call(h);
  const usage = h.ready[0].extracted.meta.usage!;
  assertEquals([usage.calls, usage.inputTokens, usage.outputTokens, usage.reasoningTokens, usage.costUsd], [1, 1200, 800, 100, 0.0104]);
});

Deno.test('resumen: con reintento por validación suma las dos llamadas', async () => {
  const h = harness({
    extract: (args) => {
      args.onUsage?.({ attempt: 1, inputTokens: 1000, outputTokens: 500, reasoningTokens: 0 });
      args.onUsage?.({ attempt: 2, inputTokens: 1000, outputTokens: 600, reasoningTokens: 50 });
      return Promise.resolve(matchingExtraction());
    }
  });
  await call(h);
  const line = summaryLogs(h)[0];
  assertEquals([line.calls, line.inputTokens, line.outputTokens, line.reasoningTokens], [2, 2000, 1100, 50]);
});

Deno.test('resumen: también se registra si la extracción falla (un intento fallido igual gasta tokens)', async () => {
  const h = harness({
    extract: (args) => {
      args.onUsage?.({ attempt: 1, inputTokens: 900, outputTokens: 40, reasoningTokens: 0 });
      return Promise.reject(new UserError('No se pudo leer el PDF con suficiente claridad. Inténtalo de nuevo o sube otro archivo.', 'x'));
    }
  });
  await call(h);
  assertEquals(h.failed.length, 1);
  const line = summaryLogs(h)[0];
  assertEquals([line.calls, line.inputTokens, line.outputTokens], [1, 900, 40]);
});

Deno.test('resumen: no se registra si ni siquiera se llegó a llamar al modelo (p. ej. no es un PDF)', async () => {
  const h = harness({ download: () => Promise.resolve(new TextEncoder().encode('<html>no</html>')) });
  await call(h);
  assertEquals(summaryLogs(h).length, 0);
});

Deno.test('resumen: modelo sin precio conocido → costo null; los precios se pueden sobrescribir con secrets', async () => {
  const unknown = harness({ env: (n) => ({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'modelo-nuevo' } as Record<string, string>)[n] });
  await call(unknown);
  assertEquals(summaryLogs(unknown)[0].costUsd, null);

  const priced = harness({
    env: (n) => ({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'modelo-nuevo', OPENAI_PRICE_INPUT_PER_M: '1', OPENAI_PRICE_OUTPUT_PER_M: '1' } as Record<string, string>)[n]
  });
  await call(priced);
  assertEquals(summaryLogs(priced)[0].costUsd, 0.002); // 2 000 tokens × US$ 1 / 1 M
});
