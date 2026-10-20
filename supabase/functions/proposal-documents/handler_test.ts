import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { handleRequest, type Deps, type ProposalRow, type SessionRow, type VisibleAttachment } from './handler.ts';
import { SIGNED_URL_TTL_SECONDS } from '../_shared/service-attachment-rules.ts';

const NOW = Date.parse('2027-01-10T12:00:00Z');
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const T1 = '31313131-3131-4131-8131-313131313131'; // public_token de P1
const T2 = '32323232-3232-4232-8232-323232323232'; // public_token de P2
const S1 = '41414141-4141-4141-8141-414141414141'; // sesión de P1
const S2 = '42424242-4242-4242-8242-424242424242'; // sesión de P2
const S_EXPIRED = '43434343-4343-4343-8343-434343434343'; // sesión vencida de P1
const SVC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SVC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SVC_GONE = 'ffffffff-ffff-4fff-8fff-ffffffffffff'; // ya no existe en el contenido
const SVC_X = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // de P2

const DOC_VISIBLE = '51515151-5151-4151-8151-515151515151';
const DOC_INTERNAL = '52525252-5252-4252-8252-525252525252';
const DOC_OTHER_SERVICE = '53535353-5353-4353-8353-535353535353';
const DOC_GONE_SERVICE = '54545454-5454-4454-8454-545454545454';
const DOC_P2 = '55555555-5555-4555-8555-555555555555';

interface Row extends VisibleAttachment {
  proposal_id: string;
  visible_to_client: boolean;
}

const content = (ids: string[]) => ({ days: [{ id: 'd1', services: ids.map((id) => ({ id })) }] });

class World {
  proposals = new Map<string, ProposalRow>([
    [P1, { id: P1, public_token: T1, status: 'published', expires_at: null, content: content([SVC_A, SVC_B]) }],
    [P2, { id: P2, public_token: T2, status: 'published', expires_at: null, content: content([SVC_X]) }]
  ]);
  sessions = new Map<string, SessionRow>([
    [S1, { proposal_id: P1, expires_at: '2027-01-10T14:00:00Z' }],
    [S2, { proposal_id: P2, expires_at: '2027-01-10T14:00:00Z' }],
    [S_EXPIRED, { proposal_id: P1, expires_at: '2027-01-10T11:00:00Z' }]
  ]);
  rows: Row[] = [
    { id: DOC_VISIBLE, proposal_id: P1, service_id: SVC_A, file_name: 'Boleto aéreo CM385.pdf', mime_type: 'application/pdf', storage_path: `${P1}/${SVC_A}/secreto-1.pdf`, visible_to_client: true },
    { id: DOC_INTERNAL, proposal_id: P1, service_id: SVC_A, file_name: 'Interno.pdf', mime_type: 'application/pdf', storage_path: `${P1}/${SVC_A}/secreto-2.pdf`, visible_to_client: false },
    { id: DOC_OTHER_SERVICE, proposal_id: P1, service_id: SVC_B, file_name: 'Confirmación hotel.pdf', mime_type: 'application/pdf', storage_path: `${P1}/${SVC_B}/secreto-3.pdf`, visible_to_client: true },
    { id: DOC_GONE_SERVICE, proposal_id: P1, service_id: SVC_GONE, file_name: 'De un servicio borrado.pdf', mime_type: 'application/pdf', storage_path: `${P1}/${SVC_GONE}/secreto-4.pdf`, visible_to_client: true },
    { id: DOC_P2, proposal_id: P2, service_id: SVC_X, file_name: 'Otra propuesta.pdf', mime_type: 'application/pdf', storage_path: `${P2}/${SVC_X}/secreto-5.pdf`, visible_to_client: true }
  ];
  signed: { path: string; ttl: number; download?: string }[] = [];

  deps: Deps = {
    env: () => undefined,
    getSession: (id) => Promise.resolve(this.sessions.get(id) ?? null),
    getProposal: (id) => Promise.resolve(this.proposals.get(id) ?? null),
    // Como la consulta real: solo visible_to_client = true y solo de esa propuesta.
    listVisible: (pid) => Promise.resolve(this.rows.filter((r) => r.proposal_id === pid && r.visible_to_client)),
    getVisible: (pid, id) => Promise.resolve(this.rows.find((r) => r.id === id && r.proposal_id === pid && r.visible_to_client) ?? null),
    createSignedUrl: (path, ttl, download) => {
      this.signed.push({ path, ttl, download });
      return Promise.resolve(`https://storage.test/sign/${path}?ttl=${ttl}`);
    },
    log: () => {}
  };

  call(body: Record<string, unknown>) {
    return handleRequest(
      new Request('https://x.test/functions/v1/proposal-documents', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
      this.deps,
      () => NOW
    ).then(async (res) => ({ status: res.status, text: await res.text() }));
  }
}

const list = (w: World, over: Record<string, unknown> = {}) => w.call({ action: 'list', token: T1, sessionToken: S1, ...over });
const url = (w: World, attachmentId: string, over: Record<string, unknown> = {}) => w.call({ action: 'url', token: T1, sessionToken: S1, attachmentId, ...over });

Deno.test('lista: solo documentos visibles de servicios que existen, y NUNCA rutas de Storage ni metadata interna', async () => {
  const w = new World();
  const res = await list(w);
  assertEquals(res.status, 200);
  const { documents } = JSON.parse(res.text);
  assertEquals(documents, [
    { id: DOC_VISIBLE, serviceId: SVC_A, name: 'Boleto aéreo CM385.pdf', mimeType: 'application/pdf' },
    { id: DOC_OTHER_SERVICE, serviceId: SVC_B, name: 'Confirmación hotel.pdf', mimeType: 'application/pdf' }
  ]);
  for (const forbidden of ['secreto', 'storage_path', 'storagePath', 'Interno', 'De un servicio borrado', 'Otra propuesta', 'visible_to_client', P1]) {
    assertFalse(res.text.includes(forbidden), `no debe aparecer: ${forbidden}`);
  }
});

Deno.test('url: un documento visible con sesión válida recibe una URL firmada de 10 minutos, sin la ruta cruda', async () => {
  const w = new World();
  const res = await url(w, DOC_VISIBLE);
  assertEquals(res.status, 200);
  const body = JSON.parse(res.text);
  assertEquals(body.expiresInSeconds, SIGNED_URL_TTL_SECONDS);
  assertEquals(SIGNED_URL_TTL_SECONDS, 600);
  assertEquals(w.signed, [{ path: `${P1}/${SVC_A}/secreto-1.pdf`, ttl: 600, download: undefined }]);
  assertEquals(Object.keys(body).sort(), ['expiresInSeconds', 'url']);
  const dl = await url(w, DOC_VISIBLE, { download: true });
  assertEquals(w.signed[1].download, 'Boleto aéreo CM385.pdf');
  assertEquals(dl.status, 200);
});

Deno.test('url: visible_to_client = false NUNCA obtiene URL firmada (404 y no se llama a Storage)', async () => {
  const w = new World();
  const res = await url(w, DOC_INTERNAL);
  assertEquals(res.status, 404);
  assertEquals(w.signed.length, 0);
  assertFalse(res.text.includes('secreto'));
});

Deno.test('url: el cliente no puede pedir un documento de otra propuesta aunque su sesión sea válida', async () => {
  const w = new World();
  const res = await url(w, DOC_P2);
  assertEquals(res.status, 404);
  assertEquals(w.signed.length, 0);
});

Deno.test('una sesión de OTRA propuesta devuelve 404 (lista y url)', async () => {
  const w = new World();
  // Sesión de P2 con el token de P1.
  assertEquals((await list(w, { sessionToken: S2 })).status, 404);
  assertEquals((await url(w, DOC_VISIBLE, { sessionToken: S2 })).status, 404);
  // Token de P2 con la sesión de P1.
  assertEquals((await list(w, { token: T2 })).status, 404);
  assertEquals((await url(w, DOC_VISIBLE, { token: T2 })).status, 404);
  assertEquals(w.signed.length, 0);
});

Deno.test('sesión vencida, inexistente o con formato inválido → 404', async () => {
  const w = new World();
  assertEquals((await list(w, { sessionToken: S_EXPIRED })).status, 404);
  assertEquals((await list(w, { sessionToken: '99999999-9999-4999-8999-999999999999' })).status, 404);
  assertEquals((await list(w, { sessionToken: 'no-uuid' })).status, 404);
  assertEquals((await list(w, { token: undefined })).status, 404);
  assertEquals((await url(w, 'no-uuid')).status, 404);
  assertEquals(w.signed.length, 0);
});

Deno.test('propuesta expirada o no publicada no entrega nada', async () => {
  const w = new World();
  w.proposals.get(P1)!.expires_at = '2027-01-10T11:59:59Z';
  assertEquals((await list(w)).status, 404);
  assertEquals((await url(w, DOC_VISIBLE)).status, 404);

  w.proposals.get(P1)!.expires_at = '2027-02-01T00:00:00Z'; // vigente
  assertEquals((await list(w)).status, 200);
  for (const status of ['draft', 'unpublished', 'archived']) {
    w.proposals.get(P1)!.status = status;
    assertEquals((await list(w)).status, 404, status);
    assertEquals((await url(w, DOC_VISIBLE)).status, 404, status);
  }
  for (const status of ['published', 'viewed', 'accepted']) {
    w.proposals.get(P1)!.status = status;
    assertEquals((await list(w)).status, 200, status);
  }
  assertEquals(w.signed.length, 0);
});

Deno.test('un documento marcado como no visible desaparece de la lista de inmediato', async () => {
  const w = new World();
  w.rows[0].visible_to_client = false;
  const { documents } = JSON.parse((await list(w)).text);
  assertEquals(documents.map((d: { id: string }) => d.id), [DOC_OTHER_SERVICE]);
  assertEquals((await url(w, DOC_VISIBLE)).status, 404);
});

Deno.test('acción inválida → 400; GET → 405; OPTIONS desde el dominio de la propuesta → 204', async () => {
  const w = new World();
  assertEquals((await w.call({ action: 'otra', token: T1, sessionToken: S1 })).status, 400);
  assertEquals((await handleRequest(new Request('https://x.test/', { method: 'GET' }), w.deps)).status, 405);
  const opt = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://thetravel-edit.com' } }), w.deps);
  assertEquals(opt.status, 204);
  assert(opt.headers.get('Access-Control-Allow-Origin') === 'https://thetravel-edit.com');
});
