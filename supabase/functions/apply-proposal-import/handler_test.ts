import { assert, assertEquals, assertStringIncludes } from 'jsr:@std/assert@1';
import { handleRequest, type Deps, type ImportRow } from './handler.ts';
import type { OriginChannel } from './tx.ts';
import { extraction } from '../_shared/test-fixtures.ts';
import { postProcessExtraction } from '../_shared/proposal-postprocess.ts';
import { rawVoucherExtraction } from '../_shared/test-fixtures-voucher.ts';

const USER = '11111111-1111-1111-1111-111111111111';
const IMPORT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const LEAD_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const PROPOSAL_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const PATH = `${USER}/cccccccc-cccc-cccc-cccc-cccccccccccc.pdf`;

const readyRow = (over: Partial<ImportRow> = {}): ImportRow => ({
  id: IMPORT_ID,
  mode: 'new',
  status: 'ready',
  file_path: PATH,
  created_by: USER,
  extracted: postProcessExtraction(rawVoucherExtraction()).extraction,
  ...over
});

interface Harness {
  deps: Deps;
  applied: { importId: string; userId: string; originChannel: OriginChannel; leadId: string | null; clientName: string; days: number }[];
  deleted: string[];
  order: string[];
  logs: string[];
}

function harness(over: Partial<Deps> = {}, row: ImportRow | null = readyRow()): Harness {
  const h: Harness = { deps: undefined as unknown as Deps, applied: [], deleted: [], order: [], logs: [] };
  h.deps = {
    env: () => undefined,
    getUser: (token) => Promise.resolve(token === 'good' ? { id: USER } : null),
    getImportAsUser: () => Promise.resolve(row),
    canManageProposals: () => Promise.resolve(true),
    canSeeLead: () => Promise.resolve(true),
    applyImport: (args) => {
      h.order.push('apply');
      h.applied.push({
        importId: args.importId,
        userId: args.userId,
        originChannel: args.originChannel,
        leadId: args.leadId,
        clientName: args.mapped.clientName,
        days: args.mapped.content.days.length
      });
      return Promise.resolve(PROPOSAL_ID);
    },
    deleteFile: (path) => {
      h.order.push('delete');
      h.deleted.push(path);
      return Promise.resolve();
    },
    log: (message, meta) => void h.logs.push(JSON.stringify({ message, ...meta })),
    ...over
  };
  return h;
}

const req = (body: unknown = { import_id: IMPORT_ID, origin_channel: 'whatsapp' }, token: string | null = 'good') =>
  new Request('https://x.test/functions/v1/apply-proposal-import', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body)
  });

Deno.test('401: sin token o con token inválido', async () => {
  const h = harness();
  assertEquals((await handleRequest(req(undefined, null), h.deps)).status, 401);
  assertEquals((await handleRequest(req(undefined, 'malo'), h.deps)).status, 401);
});

Deno.test('400: import_id inválido, canal faltante o inválido, lead_id inválido', async () => {
  const h = harness();
  assertEquals((await handleRequest(req({ origin_channel: 'web' }), h.deps)).status, 400);
  assertEquals((await handleRequest(req({ import_id: 'x', origin_channel: 'web' }), h.deps)).status, 400);
  assertEquals((await handleRequest(req({ import_id: IMPORT_ID }), h.deps)).status, 400);
  assertEquals((await handleRequest(req({ import_id: IMPORT_ID, origin_channel: 'facebook' }), h.deps)).status, 400);
  assertEquals((await handleRequest(req({ import_id: IMPORT_ID, origin_channel: 'web', lead_id: 'no-uuid' }), h.deps)).status, 400);
  assertEquals(h.applied.length, 0);
});

Deno.test('404: import ajeno (RLS no devuelve la fila)', async () => {
  const h = harness({}, null);
  assertEquals((await handleRequest(req(), h.deps)).status, 404);
  assertEquals(h.applied.length, 0);
});

Deno.test('409: modo merge', async () => {
  const h = harness({}, readyRow({ mode: 'merge' }));
  const res = await handleRequest(req(), h.deps);
  assertEquals(res.status, 409);
  assertEquals(h.applied.length, 0);
});

Deno.test('409: la importación no está en ready (uploaded, processing, failed, applied)', async () => {
  for (const status of ['uploaded', 'processing', 'failed', 'applied']) {
    const h = harness({}, readyRow({ status }));
    assertEquals((await handleRequest(req(), h.deps)).status, 409, status);
    assertEquals(h.applied.length, 0);
  }
});

Deno.test('403: sin permiso para crear propuestas', async () => {
  const h = harness({ canManageProposals: () => Promise.resolve(false) });
  assertEquals((await handleRequest(req(), h.deps)).status, 403);
  assertEquals(h.applied.length, 0);
});

Deno.test('403: lead que el usuario no puede ver', async () => {
  const h = harness({ canSeeLead: () => Promise.resolve(false) });
  const res = await handleRequest(req({ import_id: IMPORT_ID, origin_channel: 'web', lead_id: LEAD_ID }), h.deps);
  assertEquals(res.status, 403);
  assertEquals(h.applied.length, 0);
  assertEquals(h.deleted.length, 0);
});

Deno.test('con lead_id el canal se fuerza a "web", aunque se pida otro', async () => {
  const h = harness();
  const res = await handleRequest(req({ import_id: IMPORT_ID, origin_channel: 'whatsapp', lead_id: LEAD_ID }), h.deps);
  assertEquals(res.status, 200);
  assertEquals(h.applied[0].originChannel, 'web');
  assertEquals(h.applied[0].leadId, LEAD_ID);
});

Deno.test('con lead_id no hace falta indicar canal; sin lead_id va el canal elegido y lead null', async () => {
  const withLead = harness();
  assertEquals((await handleRequest(req({ import_id: IMPORT_ID, lead_id: LEAD_ID }), withLead.deps)).status, 200);
  assertEquals(withLead.applied[0].originChannel, 'web');

  const without = harness();
  assertEquals((await handleRequest(req({ import_id: IMPORT_ID, origin_channel: 'referral' }), without.deps)).status, 200);
  assertEquals(without.applied[0].originChannel, 'referral');
  assertEquals(without.applied[0].leadId, null);
});

Deno.test('éxito: mapea lo extraído, crea la propuesta, borra el PDF DESPUÉS y responde { proposal_id }', async () => {
  const h = harness();
  const res = await handleRequest(req(), h.deps);
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { proposal_id: PROPOSAL_ID });
  assertEquals(h.applied[0].userId, USER);
  assertEquals(h.applied[0].clientName, 'Persona Ejemplo');
  assertEquals(h.applied[0].days, 4);
  assertEquals(h.deleted, [PATH]);
  assertEquals(h.order, ['apply', 'delete']); // el borrado es posterior a la transacción
});

Deno.test('éxito con pricing null: la propuesta se crea igual', async () => {
  const extracted = postProcessExtraction(
    extraction({ days: [{ number: 1, date: null, base_city: null, title: null, summary: null, services: [] }], client: { name: 'Solo Nombre', email: null, phone: null } })
  ).extraction;
  const h = harness({}, readyRow({ extracted }));
  assertEquals((await handleRequest(req(), h.deps)).status, 200);
  assertEquals(h.applied[0].clientName, 'Solo Nombre');
});

Deno.test('doble llamada: la segunda recibe 409 (otra pestaña ya la aplicó) y no borra nada', async () => {
  let taken = false;
  const h = harness({
    applyImport: () => {
      if (taken) {
        return Promise.resolve('conflict' as const);
      }
      taken = true;
      return Promise.resolve(PROPOSAL_ID);
    }
  });
  assertEquals((await handleRequest(req(), h.deps)).status, 200);
  const second = await handleRequest(req(), h.deps);
  assertEquals(second.status, 409);
  assertStringIncludes((await second.json()).error, 'otra pestaña');
  assertEquals(h.deleted.length, 1); // solo el de la primera
});

Deno.test('si el borrado del PDF falla: se registra en el log y la respuesta sigue siendo éxito', async () => {
  const h = harness({ deleteFile: () => Promise.reject(new Error('storage caído')) });
  const res = await handleRequest(req(), h.deps);
  assertEquals(res.status, 200);
  assertEquals((await res.json()).proposal_id, PROPOSAL_ID);
  assert(h.logs.some((l) => l.includes('apply.delete_file_failed') && l.includes('storage caído')));
});

Deno.test('si la transacción falla: 500 genérico, sin detalles técnicos y sin borrar el PDF', async () => {
  const h = harness({ applyImport: () => Promise.reject(new Error('violates check constraint "x" en tabla proposals')) });
  const res = await handleRequest(req(), h.deps);
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.error, 'No se pudo crear la propuesta. Inténtalo de nuevo.');
  assert(!JSON.stringify(body).includes('constraint'));
  assertEquals(h.deleted.length, 0);
  assert(h.logs.some((l) => l.includes('constraint'))); // el detalle va solo al log
});

Deno.test('datos extraídos inválidos: 422 y no se crea nada', async () => {
  const h = harness({}, readyRow({ extracted: { esto: 'no es una extracción' } }));
  assertEquals((await handleRequest(req(), h.deps)).status, 422);
  assertEquals(h.applied.length, 0);
});

Deno.test('CORS: solo los dominios de ALLOWED_ORIGINS; nunca *', async () => {
  const h = harness({ env: (n) => (n === 'ALLOWED_ORIGINS' ? 'https://admin.ejemplo.test' : undefined) });
  const ok = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://admin.ejemplo.test' } }), h.deps);
  assertEquals(ok.status, 204);
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), 'https://admin.ejemplo.test');
  const bad = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://otro.test' } }), h.deps);
  assertEquals(bad.headers.get('Access-Control-Allow-Origin'), null);
});

Deno.test('GET no está permitido', async () => {
  const h = harness();
  assertEquals((await handleRequest(new Request('https://x.test/', { method: 'GET' }), h.deps)).status, 405);
});
