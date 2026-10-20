import { assert, assertEquals, assertFalse, assertMatch, assertNotEquals } from 'jsr:@std/assert@1';
import { handleRequest, type AttachmentRow, type Deps, type InsertResult } from './handler.ts';
import { MAX_FILE_BYTES, MAX_FILES_PER_SERVICE, SIGNED_URL_TTL_SECONDS, parseStoragePath } from '../_shared/service-attachment-rules.ts';

// ---------------------------------------------------------------- mundo falso (Storage + tabla + RLS)

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const SVC_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; // P1, día 1
const SVC_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; // P1, día 1
const SVC_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; // P1, día 2
const SVC_X = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'; // P2, día 1 (otra propuesta)
const ADMIN = '99999999-9999-4999-8999-999999999991';
const ADVISOR = '99999999-9999-4999-8999-999999999992';
const VIEWER = '99999999-9999-4999-8999-999999999993';

const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const HTML = new TextEncoder().encode('<html><script>alert(1)</script></html>');

const contentP1 = () => ({
  cover: { title: 'Viaje 1' },
  days: [
    { id: 'day-1', dayNumber: 1, title: 'Uno', services: [{ id: SVC_A, title: 'Vuelo' }, { id: SVC_B, title: 'Hotel' }] },
    { id: 'day-2', dayNumber: 2, title: 'Dos', services: [{ id: SVC_C, title: 'Tour' }] }
  ]
});
const contentP2 = () => ({ cover: { title: 'Viaje 2' }, days: [{ id: 'day-x', dayNumber: 1, title: 'X', services: [{ id: SVC_X, title: 'Otro' }] }] });

const TOKENS: Record<string, { id: string; manages: boolean; admin: boolean; sees: string[] }> = {
  'admin-token': { id: ADMIN, manages: true, admin: true, sees: [P1, P2] },
  // Asesora: solo ve P2 (RLS de proposals).
  'advisor-token': { id: ADVISOR, manages: true, admin: false, sees: [P2] },
  // Autenticado sin permiso para gestionar propuestas.
  'viewer-token': { id: VIEWER, manages: false, admin: false, sees: [] }
};

class World {
  proposals = new Map<string, { content: unknown; updated_at: string }>([
    [P1, { content: contentP1(), updated_at: 'v1' }],
    [P2, { content: contentP2(), updated_at: 'w1' }]
  ]);
  rows: AttachmentRow[] = [];
  objects = new Map<string, Uint8Array>();
  signedUploads: string[] = [];
  signedReads: string[] = [];
  logs: string[] = [];
  failRemove = new Set<string>();
  failInsert: InsertResult | null = null;
  rejectReplace = false;
  /** Simula que Storage no puede verificar el objeto (error de red / 5xx). */
  inspectError = false;
  /** Se ejecuta antes de la siguiente escritura de contenido (simula a otra pestaña que se adelanta). */
  beforeContentUpdate: (() => void) | null = null;
  version = 1;
  seq = 0;

  deps: Deps = {
    env: () => undefined,
    getUser: (token) => Promise.resolve(TOKENS[token] ? { id: TOKENS[token].id } : null),
    canManageProposals: (token) => Promise.resolve(TOKENS[token]?.manages === true),
    getProposalAsUser: (token, id) => {
      const p = this.proposals.get(id);
      return Promise.resolve(p && TOKENS[token]?.sees.includes(id) ? { id, content: structuredClone(p.content), updated_at: p.updated_at } : null);
    },
    updateContentAsUser: (token, id, expected, content) => {
      this.beforeContentUpdate?.();
      this.beforeContentUpdate = null;
      const p = this.proposals.get(id);
      if (!p || !TOKENS[token]?.sees.includes(id) || p.updated_at !== expected) {
        return Promise.resolve(null);
      }
      p.content = structuredClone(content);
      p.updated_at = `v${++this.version}`;
      return Promise.resolve({ id, content: structuredClone(p.content), updated_at: p.updated_at });
    },
    isAdmin: (userId) => Promise.resolve(Object.values(TOKENS).some((t) => t.id === userId && t.admin)),

    getAttachment: (id) => Promise.resolve(this.rows.find((r) => r.id === id) ?? null),
    findByPath: (path) => Promise.resolve(this.rows.find((r) => r.storage_path === path) ?? null),
    listForServices: (pid, ids) => Promise.resolve(this.rows.filter((r) => r.proposal_id === pid && ids.includes(r.service_id))),
    listForProposal: (pid) => Promise.resolve(this.rows.filter((r) => r.proposal_id === pid)),
    insertAttachment: (row) => {
      if (this.failInsert) {
        return Promise.resolve(this.failInsert);
      }
      if (this.rows.some((r) => r.storage_path === row.storage_path)) {
        return Promise.resolve({ error: 'duplicate_path' as const });
      }
      const created: AttachmentRow = { ...row, id: crypto.randomUUID(), created_at: `t${++this.seq}`, updated_at: `t${this.seq}` };
      this.rows.push(created);
      return Promise.resolve({ row: created });
    },
    replaceFile: (id, expectedPath, patch) => {
      const row = this.rows.find((r) => r.id === id && r.storage_path === expectedPath);
      if (!row || this.rejectReplace) {
        return Promise.resolve(null);
      }
      Object.assign(row, patch, { updated_at: `t${++this.seq}` });
      return Promise.resolve(row);
    },
    setVisible: (id, visible) => {
      const row = this.rows.find((r) => r.id === id);
      if (row) {
        row.visible_to_client = visible;
      }
      return Promise.resolve(row ?? null);
    },
    deleteRow: (id) => {
      this.rows = this.rows.filter((r) => r.id !== id);
      return Promise.resolve();
    },

    createSignedUploadUrl: (path) => {
      this.signedUploads.push(path);
      return Promise.resolve({ token: `upload-token-for-${path}`, signedUrl: `https://storage.test/upload/${path}` });
    },
    inspectObject: (path, headBytes) => {
      if (this.inspectError) {
        return Promise.resolve({ status: 'error' as const, reason: 'storage no responde' });
      }
      const bytes = this.objects.get(path);
      return Promise.resolve(bytes ? { status: 'ok' as const, size: bytes.length, head: bytes.slice(0, headBytes) } : { status: 'missing' as const });
    },
    removeObject: (path) => {
      if (this.failRemove.has(path)) {
        return Promise.reject(new Error('storage caído'));
      }
      this.objects.delete(path);
      return Promise.resolve();
    },
    createSignedUrl: (path, ttl, downloadName) => {
      this.signedReads.push(path);
      return Promise.resolve(`https://storage.test/sign/${path}?ttl=${ttl}${downloadName ? '&download=1' : ''}`);
    },
    log: (message, meta) => void this.logs.push(JSON.stringify({ message, ...meta }))
  };

  /** Simula la subida directa del navegador a la URL firmada. */
  upload(path: string, bytes: Uint8Array): void {
    this.objects.set(path, bytes);
  }

  call(token: string | null, body: Record<string, unknown>): Promise<{ status: number; body: Record<string, any> }> {
    return handleRequest(
      new Request('https://x.test/functions/v1/proposal-service-files', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body)
      }),
      this.deps
    ).then(async (res) => ({ status: res.status, body: await res.json() }));
  }

  /** prepare → subida directa → finalize, como lo hace el admin. */
  async attach(opts: { token?: string; proposalId?: string; serviceId?: string; fileName?: string; mime?: string; bytes?: Uint8Array; replace?: string } = {}) {
    const token = opts.token ?? 'admin-token';
    const proposalId = opts.proposalId ?? P1;
    const serviceId = opts.serviceId ?? SVC_A;
    const bytes = opts.bytes ?? PDF;
    const fileName = opts.fileName ?? 'Boleto aéreo CM385.pdf';
    const prep = await this.call(token, {
      action: 'prepare-upload',
      proposalId,
      serviceId,
      fileName,
      mimeType: opts.mime ?? 'application/pdf',
      fileSize: bytes.length,
      replaceAttachmentId: opts.replace
    });
    assertEquals(prep.status, 200, JSON.stringify(prep.body));
    this.upload(prep.body.storagePath, bytes);
    return {
      path: prep.body.storagePath as string,
      finalize: () =>
        this.call(token, { action: 'finalize-upload', proposalId, serviceId, storagePath: prep.body.storagePath, fileName, replaceAttachmentId: opts.replace })
    };
  }
}

// ---------------------------------------------------------------- autenticación y permisos

Deno.test('401 sin token o con token inválido; 400 sin acción; 405 con GET', async () => {
  const w = new World();
  assertEquals((await w.call(null, { action: 'sign' })).status, 401);
  assertEquals((await w.call('malo', { action: 'sign' })).status, 401);
  assertEquals((await w.call('admin-token', {})).status, 400);
  assertEquals((await w.call('admin-token', { action: 'nada' })).status, 400);
  const get = await handleRequest(new Request('https://x.test/', { method: 'GET' }), w.deps);
  assertEquals(get.status, 405);
});

Deno.test('OPTIONS desde el dominio del admin → 204 con CORS', async () => {
  const w = new World();
  const res = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://thetravel-edit.com' } }), w.deps);
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), 'https://thetravel-edit.com');
});

Deno.test('un usuario autenticado SIN permiso para gestionar propuestas no puede nada (403)', async () => {
  const w = new World();
  for (const action of ['prepare-upload', 'finalize-upload', 'set-visibility', 'delete', 'sign', 'remove-service', 'remove-day', 'purge-proposal']) {
    const res = await w.call('viewer-token', { action, proposalId: P1, serviceId: SVC_A });
    assertEquals(res.status, 403, action);
  }
  assertEquals(w.signedUploads.length, 0);
});

Deno.test('una Asesora no toca propuestas ajenas: prepare, finalize, visibilidad, borrar y firmar → 404', async () => {
  const w = new World();
  const mine = await w.attach(); // el admin sube un documento a P1
  const done = await mine.finalize();
  assertEquals(done.status, 200);
  const id = done.body.attachment.id;

  const prep = await w.call('advisor-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_A, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 });
  assertEquals(prep.status, 404);
  const fin = await w.call('advisor-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: mine.path, fileName: 'a.pdf' });
  assertEquals(fin.status, 404);
  for (const action of ['set-visibility', 'delete', 'sign']) {
    assertEquals((await w.call('advisor-token', { action, attachmentId: id, visible: true })).status, 404, action);
  }
  assertEquals((await w.call('advisor-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true, expectedCount: 1 })).status, 404);
  // Nada se tocó.
  assertEquals(w.rows.length, 1);
  assert(w.objects.has(mine.path));
  assertEquals(w.signedUploads.length, 1);
});

// ---------------------------------------------------------------- subida: prepare

Deno.test('prepare: usuario autorizado recibe una ruta generada por el servidor y una URL firmada', async () => {
  const w = new World();
  const res = await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_A, fileName: 'Boleto aéreo CM385.pdf', mimeType: 'application/pdf', fileSize: 1234 });
  assertEquals(res.status, 200);
  const parsed = parseStoragePath(res.body.storagePath);
  assert(parsed);
  assertEquals([parsed.proposalId, parsed.serviceId, parsed.ext], [P1, SVC_A, 'pdf']);
  assertFalse(String(res.body.storagePath).includes('Boleto'), 'el nombre original no forma parte de la ruta');
  assertEquals(w.signedUploads, [res.body.storagePath]);
  assertMatch(res.body.signedUrl, /^https:\/\//);
  assertEquals(w.rows.length, 0, 'prepare no crea metadata');
});

Deno.test('prepare: el cliente no puede elegir la ruta (storagePath/path del cuerpo se ignoran)', async () => {
  const w = new World();
  const evil = `${P2}/${SVC_X}/${crypto.randomUUID()}.pdf`;
  const res = await w.call('admin-token', {
    action: 'prepare-upload', proposalId: P1, serviceId: SVC_A, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10,
    storagePath: evil, path: evil, id: crypto.randomUUID()
  });
  assertEquals(res.status, 200);
  assertNotEquals(res.body.storagePath, evil);
  assertEquals(parseStoragePath(res.body.storagePath)?.proposalId, P1);
  assertEquals(w.signedUploads.length, 1);
  assertNotEquals(w.signedUploads[0], evil);
});

Deno.test('prepare: un serviceId de OTRA propuesta se rechaza (proposal A + service de B)', async () => {
  const w = new World();
  const res = await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_X, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 });
  assertEquals(res.status, 404);
  assertEquals(res.body.code, 'service_not_found');
  assertEquals(w.signedUploads.length, 0);
});

Deno.test('prepare: MIME inválido, extensión falsa, vacío y > 10 MB se rechazan ANTES de autorizar la subida', async () => {
  const w = new World();
  const base = { action: 'prepare-upload', proposalId: P1, serviceId: SVC_A, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 };
  const cases: [Record<string, unknown>, string][] = [
    [{ mimeType: 'application/msword', fileName: 'a.doc' }, 'invalid_mime'],
    [{ mimeType: 'image/svg+xml', fileName: 'a.svg' }, 'invalid_mime'],
    [{ mimeType: 'text/html', fileName: 'a.html' }, 'invalid_mime'],
    [{ fileName: 'a.exe' }, 'invalid_extension'],
    [{ fileSize: 0 }, 'empty_file'],
    [{ fileSize: MAX_FILE_BYTES + 1 }, 'too_large']
  ];
  for (const [patch, code] of cases) {
    const res = await w.call('admin-token', { ...base, ...patch });
    assertEquals(res.status, 400, code);
    assertEquals(res.body.code, code);
  }
  assertEquals(w.signedUploads.length, 0);
  // Justo en el límite sí pasa.
  assertEquals((await w.call('admin-token', { ...base, fileSize: MAX_FILE_BYTES })).status, 200);
});

Deno.test('prepare: ids raros (rutas, traversal) → 400', async () => {
  const w = new World();
  for (const serviceId of ['../x', 'a/b', '', 'x'.repeat(80)]) {
    const res = await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 });
    assertEquals(res.status, 400, serviceId);
  }
  assertEquals((await w.call('admin-token', { action: 'prepare-upload', proposalId: 'no-uuid', serviceId: SVC_A, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 })).status, 400);
});

Deno.test('prepare: máximo 10 archivos por servicio', async () => {
  const w = new World();
  for (let i = 0; i < MAX_FILES_PER_SERVICE; i++) {
    const a = await w.attach({ fileName: `doc${i}.pdf` });
    assertEquals((await a.finalize()).status, 200);
  }
  const res = await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_A, fileName: 'otro.pdf', mimeType: 'application/pdf', fileSize: 10 });
  assertEquals(res.status, 409);
  assertEquals(res.body.code, 'too_many_files');
  // Otro servicio de la misma propuesta no se ve afectado.
  assertEquals((await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_B, fileName: 'otro.pdf', mimeType: 'application/pdf', fileSize: 10 })).status, 200);
});

// ---------------------------------------------------------------- subida: finalize

Deno.test('finalize: sube, lista y elimina un documento (flujo completo del admin)', async () => {
  const w = new World();
  const a = await w.attach();
  const res = await a.finalize();
  assertEquals(res.status, 200);
  const att = res.body.attachment;
  assertEquals([att.fileName, att.mimeType, att.fileSize, att.visibleToClient, att.serviceId, att.proposalId], ['Boleto aéreo CM385.pdf', 'application/pdf', PDF.length, false, SVC_A, P1]);
  assertFalse(JSON.stringify(res.body).includes(a.path), 'la respuesta no expone la ruta de Storage');
  assertEquals(w.rows.length, 1);
  assertEquals(w.rows[0].created_by, ADMIN);
  assertEquals(w.rows[0].storage_path, a.path);

  const del = await w.call('admin-token', { action: 'delete', attachmentId: att.id });
  assertEquals(del.status, 200);
  assertEquals(w.rows.length, 0);
  assertFalse(w.objects.has(a.path), 'el objeto también se borra');
});

Deno.test('finalize: el nombre se limpia y el documento nace NO visible para el cliente', async () => {
  const w = new World();
  const a = await w.attach({ fileName: '../../Mi\u0000 voucher.pdf' });
  const res = await a.finalize();
  assertEquals(res.body.attachment.fileName, 'Mi voucher.pdf');
  assertEquals(res.body.attachment.visibleToClient, false);
});

Deno.test('finalize: una ruta AJENA (otra propuesta u otro servicio) falla y no toca el objeto', async () => {
  const w = new World();
  const other = `${P2}/${SVC_X}/${crypto.randomUUID()}.pdf`;
  w.upload(other, PDF);
  // Ruta de P2 dicha como P1.
  let res = await w.call('admin-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: other, fileName: 'a.pdf' });
  assertEquals([res.status, res.body.code], [400, 'invalid_path']);
  // Ruta de otro servicio de la misma propuesta.
  const sibling = `${P1}/${SVC_B}/${crypto.randomUUID()}.pdf`;
  w.upload(sibling, PDF);
  res = await w.call('admin-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: sibling, fileName: 'a.pdf' });
  assertEquals([res.status, res.body.code], [400, 'invalid_path']);
  // Rutas inventadas.
  for (const path of [`${P1}/${SVC_A}/boleto.pdf`, `${P1}/${SVC_A}/../${SVC_B}/${crypto.randomUUID()}.pdf`, 'otra/cosa']) {
    assertEquals((await w.call('admin-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: path, fileName: 'a.pdf' })).status, 400, path);
  }
  assert(w.objects.has(other) && w.objects.has(sibling), 'los objetos ajenos siguen ahí');
  assertEquals(w.rows.length, 0);
});

Deno.test('finalize: sin objeto subido → 404 y no se crea metadata', async () => {
  const w = new World();
  const path = `${P1}/${SVC_A}/${crypto.randomUUID()}.pdf`;
  const res = await w.call('admin-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: path, fileName: 'a.pdf' });
  assertEquals([res.status, res.body.code], [404, 'object_missing']);
  assertEquals(w.rows.length, 0);
});

Deno.test('finalize: magic bytes incorrectos (un HTML con extensión .pdf) → se elimina el objeto y no hay metadata', async () => {
  const w = new World();
  const a = await w.attach({ bytes: HTML });
  const res = await a.finalize();
  assertEquals([res.status, res.body.code], [400, 'invalid_file_type']);
  assertFalse(w.objects.has(a.path), 'el objeto rechazado se borra');
  assertEquals(w.rows.length, 0);
});

Deno.test('finalize: un PNG subido como .pdf no coincide y se elimina', async () => {
  const w = new World();
  const a = await w.attach({ bytes: PNG, mime: 'application/pdf', fileName: 'falso.pdf' });
  const res = await a.finalize();
  assertEquals(res.body.code, 'invalid_file_type');
  assertEquals(w.objects.size, 0);
});

Deno.test('finalize: un objeto que supera 10 MB (aunque se haya declarado menos) se elimina', async () => {
  const w = new World();
  const a = await w.attach({ bytes: PDF });
  const big = new Uint8Array(MAX_FILE_BYTES + 1);
  big.set(PDF);
  w.upload(a.path, big);
  const res = await a.finalize();
  assertEquals([res.status, res.body.code], [400, 'too_large']);
  assertEquals(w.objects.size, 0);
  assertEquals(w.rows.length, 0);
});

Deno.test('finalize: si Storage no puede verificar el objeto responde 502 SIN borrarlo ni crear metadata; reintentar funciona', async () => {
  const w = new World();
  const a = await w.attach();
  w.inspectError = true;
  const res = await a.finalize();
  assertEquals([res.status, res.body.code], [502, 'inspect_failed']);
  assert(w.objects.has(a.path), 'un fallo transitorio no borra un archivo que puede ser válido');
  assertEquals(w.rows.length, 0);
  w.inspectError = false;
  assertEquals((await a.finalize()).status, 200);
  assertEquals(w.rows.length, 1);
});

Deno.test('finalize: un objeto vacío se elimina', async () => {
  const w = new World();
  const a = await w.attach();
  w.upload(a.path, new Uint8Array());
  const res = await a.finalize();
  assertEquals(res.body.code, 'empty_file');
  assertEquals(w.objects.size, 0);
});

Deno.test('finalize: doble finalize de la misma ruta devuelve el mismo documento (sin duplicados)', async () => {
  const w = new World();
  const a = await w.attach();
  const first = await a.finalize();
  const second = await a.finalize();
  assertEquals(second.status, 200);
  assertEquals(second.body.attachment.id, first.body.attachment.id);
  assertEquals(w.rows.length, 1);
  assert(w.objects.has(a.path), 'el objeto del documento no se borra en la segunda llamada');
});

Deno.test('finalize: dos finalize simultáneos (carrera en el insert) terminan con una sola fila y el objeto intacto', async () => {
  const w = new World();
  const a = await w.attach();
  const real = w.deps.insertAttachment;
  let first = true;
  w.deps.insertAttachment = async (row) => {
    if (first) {
      first = false;
      await real(row); // la otra llamada ganó la carrera
    }
    return real(row);
  };
  const res = await a.finalize();
  assertEquals(res.status, 200);
  assertEquals(w.rows.length, 1);
  assert(w.objects.has(a.path));
});

Deno.test('finalize: si el insert falla se elimina el objeto (no queda archivo sin metadata)', async () => {
  const w = new World();
  const a = await w.attach();
  w.failInsert = { error: 'too_many_files' };
  const res = await a.finalize();
  assertEquals(res.status, 409);
  assertEquals(w.objects.size, 0);
  assertEquals(w.rows.length, 0);
});

Deno.test('finalize: un usuario de OTRA propuesta (Asesora sin acceso) no puede finalizar ni borrar el objeto', async () => {
  const w = new World();
  const a = await w.attach(); // objeto subido por el admin a P1
  const res = await w.call('advisor-token', { action: 'finalize-upload', proposalId: P1, serviceId: SVC_A, storagePath: a.path, fileName: 'a.pdf' });
  assertEquals(res.status, 404);
  assert(w.objects.has(a.path));
  assertEquals(w.rows.length, 0);
});

// ---------------------------------------------------------------- visibilidad, firmar, borrar

Deno.test('visibilidad: por defecto false, se puede activar y desactivar', async () => {
  const w = new World();
  const id = (await (await w.attach()).finalize()).body.attachment.id;
  assertEquals(w.rows[0].visible_to_client, false);
  let res = await w.call('admin-token', { action: 'set-visibility', attachmentId: id, visible: true });
  assertEquals([res.status, res.body.attachment.visibleToClient], [200, true]);
  res = await w.call('admin-token', { action: 'set-visibility', attachmentId: id, visible: false });
  assertEquals(res.body.attachment.visibleToClient, false);
  assertEquals((await w.call('admin-token', { action: 'set-visibility', attachmentId: id, visible: 'si' })).status, 400);
});

Deno.test('firmar: el admin recibe una URL de 10 minutos; con download lleva el nombre', async () => {
  const w = new World();
  const a = await w.attach();
  const id = (await a.finalize()).body.attachment.id;
  const res = await w.call('admin-token', { action: 'sign', attachmentId: id });
  assertEquals([res.status, res.body.expiresInSeconds], [200, SIGNED_URL_TTL_SECONDS]);
  assertEquals(SIGNED_URL_TTL_SECONDS, 600);
  assertMatch(res.body.url, /ttl=600/);
  assertFalse(res.body.url.includes('download'));
  assertMatch((await w.call('admin-token', { action: 'sign', attachmentId: id, download: true })).body.url, /download=1/);
});

Deno.test('eliminar: primero el objeto y luego la fila; si Storage falla la fila se conserva y se puede reintentar', async () => {
  const w = new World();
  const a = await w.attach();
  const id = (await a.finalize()).body.attachment.id;
  w.failRemove.add(a.path);
  const res = await w.call('admin-token', { action: 'delete', attachmentId: id });
  assertEquals([res.status, res.body.code], [502, 'storage_failed']);
  assertEquals(w.rows.length, 1, 'la fila sigue: nada de referencias rotas ni archivos invisibles');
  w.failRemove.clear();
  assertEquals((await w.call('admin-token', { action: 'delete', attachmentId: id })).status, 200);
  assertEquals([w.rows.length, w.objects.size], [0, 0]);
  // Reintentar un borrado ya hecho no inventa nada.
  assertEquals((await w.call('admin-token', { action: 'delete', attachmentId: id })).status, 404);
});

// ---------------------------------------------------------------- reemplazo

Deno.test('reemplazo: conserva el id y la visibilidad, apunta al archivo nuevo y recién entonces borra el viejo', async () => {
  const w = new World();
  const first = await w.attach();
  const att = (await first.finalize()).body.attachment;
  await w.call('admin-token', { action: 'set-visibility', attachmentId: att.id, visible: true });

  const second = await w.attach({ replace: att.id, bytes: PNG, mime: 'image/png', fileName: 'Comprobante.png' });
  // Antes de finalizar, el archivo viejo sigue siendo el del documento.
  assertEquals(w.rows[0].storage_path, first.path);
  assert(w.objects.has(first.path));

  const res = await second.finalize();
  assertEquals(res.status, 200);
  assertEquals(res.body.attachment.id, att.id);
  assertEquals([res.body.attachment.fileName, res.body.attachment.mimeType, res.body.attachment.visibleToClient], ['Comprobante.png', 'image/png', true]);
  assertEquals(w.rows.length, 1);
  assertEquals(w.rows[0].storage_path, second.path);
  assertFalse(w.objects.has(first.path), 'el viejo se retira al final');
  assert(w.objects.has(second.path));
});

Deno.test('reemplazo: si finalize falla (archivo inválido) el archivo viejo sigue funcionando', async () => {
  const w = new World();
  const first = await w.attach();
  const att = (await first.finalize()).body.attachment;
  const bad = await w.attach({ replace: att.id, bytes: HTML, fileName: 'malo.pdf' });
  const res = await bad.finalize();
  assertEquals(res.status, 400);
  assertEquals(w.rows[0].storage_path, first.path, 'la fila sigue apuntando al archivo viejo');
  assert(w.objects.has(first.path), 'el objeto viejo está intacto');
  assertFalse(w.objects.has(bad.path), 'el nuevo, rechazado, se borra');
  // El documento sigue pudiéndose firmar.
  assertEquals((await w.call('admin-token', { action: 'sign', attachmentId: att.id })).status, 200);
});

Deno.test('reemplazo: si la fila cambió mientras tanto (conflicto) se descarta el nuevo y el viejo no se toca', async () => {
  const w = new World();
  const first = await w.attach();
  const att = (await first.finalize()).body.attachment;
  const next = await w.attach({ replace: att.id });
  w.rejectReplace = true;
  const res = await next.finalize();
  assertEquals([res.status, res.body.code], [409, 'conflict']);
  assert(w.objects.has(first.path));
  assertFalse(w.objects.has(next.path));
  assertEquals(w.rows[0].storage_path, first.path);
});

Deno.test('reemplazo: si no se puede borrar el viejo, el reemplazo igual queda hecho y se registra el huérfano', async () => {
  const w = new World();
  const first = await w.attach();
  const att = (await first.finalize()).body.attachment;
  const next = await w.attach({ replace: att.id });
  w.failRemove.add(first.path);
  const res = await next.finalize();
  assertEquals(res.status, 200);
  assertEquals(w.rows[0].storage_path, next.path);
  assert(w.logs.some((l) => l.includes('replace_old_object_leaked')));
});

Deno.test('reemplazo: no se puede reemplazar el documento de otro servicio o propuesta', async () => {
  const w = new World();
  const att = (await (await w.attach()).finalize()).body.attachment; // en SVC_A
  const res = await w.call('admin-token', { action: 'prepare-upload', proposalId: P1, serviceId: SVC_B, fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10, replaceAttachmentId: att.id });
  assertEquals(res.status, 404);
});

// ---------------------------------------------------------------- borrar un servicio / un día con documentos

async function withDocs(w: World) {
  const a1 = await (await w.attach({ serviceId: SVC_A, fileName: 'uno.pdf' })).finalize();
  const a2 = await (await w.attach({ serviceId: SVC_A, fileName: 'dos.pdf' })).finalize();
  const b1 = await (await w.attach({ serviceId: SVC_B, fileName: 'otro-servicio.pdf' })).finalize();
  const c1 = await (await w.attach({ serviceId: SVC_C, fileName: 'otro-dia.pdf' })).finalize();
  const x1 = await (await w.attach({ proposalId: P2, serviceId: SVC_X, fileName: 'otra-propuesta.pdf' })).finalize();
  return { a1, a2, b1, c1, x1 };
}
const contentOf = (w: World, id = P1) => w.proposals.get(id)!.content as ReturnType<typeof contentP1>;
const serviceIdsIn = (w: World, id = P1) => contentOf(w, id).days.flatMap((d) => d.services.map((s) => s.id));

Deno.test('borrar servicio con documentos: exige confirmación y no toca nada hasta recibirla', async () => {
  const w = new World();
  await withDocs(w);
  const before = structuredClone(contentOf(w));
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A });
  assertEquals([res.status, res.body.code, res.body.attachmentCount], [409, 'confirmation_required', 2]);
  assertEquals(contentOf(w), before);
  assertEquals(w.rows.length, 5);
  assertEquals(w.objects.size, 5);
  // confirm sin el recuento que vio el usuario tampoco basta.
  const noCount = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true });
  assertEquals(noCount.body.code, 'count_changed');
  assertEquals(w.rows.length, 5);
});

Deno.test('borrar servicio: si aparecieron documentos tras mostrar la confirmación, pide confirmar de nuevo', async () => {
  const w = new World();
  await withDocs(w);
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true, expectedCount: 1 });
  assertEquals([res.status, res.body.code, res.body.attachmentCount], [409, 'count_changed', 2]);
  assertEquals(w.rows.length, 5);
  assert(serviceIdsIn(w).includes(SVC_A));
});

Deno.test('borrar servicio confirmado: quita el servicio, purga sus documentos (Storage y filas) y no toca los demás', async () => {
  const w = new World();
  await withDocs(w);
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true, expectedCount: 2 });
  assertEquals(res.status, 200);
  assertEquals(res.body.deletedDocuments, 2);
  assertEquals(serviceIdsIn(w), [SVC_B, SVC_C]);
  assertEquals(res.body.content.days[0].services.map((s: { id: string }) => s.id), [SVC_B]);
  assertEquals(res.body.content.cover, { title: 'Viaje 1' });
  // Solo se fueron los de SVC_A.
  assertEquals(w.rows.map((r) => r.file_name).sort(), ['otra-propuesta.pdf', 'otro-dia.pdf', 'otro-servicio.pdf']);
  assertEquals(w.objects.size, 3);
});

Deno.test('borrar servicio sin documentos no pide confirmación', async () => {
  const w = new World();
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_B });
  assertEquals([res.status, res.body.deletedDocuments], [200, 0]);
  assertEquals(serviceIdsIn(w), [SVC_A, SVC_C]);
});

Deno.test('borrar servicio: un serviceId de OTRA propuesta no purga documentos ni cambia contenido', async () => {
  const w = new World();
  await withDocs(w);
  const before = structuredClone(contentOf(w));
  // SVC_X es de P2: pedido sobre P1 → 404, y los documentos de P2 siguen.
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_X, confirm: true, expectedCount: 1 });
  assertEquals([res.status, res.body.code], [404, 'service_not_found']);
  assertEquals(w.rows.length, 5);
  assertEquals(w.objects.size, 5);
  assertEquals(contentOf(w), before);
  // Un servicio de P1 pedido con el día equivocado tampoco.
  const wrongDay = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, dayId: 'day-2', confirm: true, expectedCount: 2 });
  assertEquals(wrongDay.status, 404);
  assertEquals(w.rows.length, 5);
});

Deno.test('borrar servicio: si Storage falla se detiene SIN tocar el contenido (nada de huérfanos); reintentar lo completa', async () => {
  const w = new World();
  const d = await withDocs(w);
  const secondPath = w.rows.find((r) => r.id === d.a2.body.attachment.id)!.storage_path;
  w.failRemove.add(secondPath);
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true, expectedCount: 2 });
  assertEquals([res.status, res.body.code, res.body.purged, res.body.remaining], [502, 'storage_failed', 1, 1]);
  assert(serviceIdsIn(w).includes(SVC_A), 'el servicio sigue en el contenido');
  assertEquals(w.rows.filter((r) => r.service_id === SVC_A).length, 1, 'solo queda el documento que no se pudo borrar, con su fila');
  w.failRemove.clear();
  const retry = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_A, confirm: true, expectedCount: 1 });
  assertEquals([retry.status, retry.body.deletedDocuments], [200, 1]);
  assertFalse(serviceIdsIn(w).includes(SVC_A));
  assertEquals(w.rows.filter((r) => r.service_id === SVC_A).length, 0);
});

Deno.test('borrar servicio: parte del contenido ACTUAL de la base, no de una pestaña vieja (no pisa servicios nuevos)', async () => {
  const w = new World();
  const SVC_NEW = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  // Otra pestaña agrega un servicio justo antes de que se guarde la baja: el updated_at cambia y se reintenta.
  w.beforeContentUpdate = () => {
    const p = w.proposals.get(P1)!;
    (p.content as ReturnType<typeof contentP1>).days[1].services.push({ id: SVC_NEW, title: 'Nuevo' });
    p.updated_at = 'v-otra-pestana';
  };
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_B });
  assertEquals(res.status, 200);
  assertEquals(serviceIdsIn(w), [SVC_A, SVC_C, SVC_NEW]);
});

Deno.test('borrar servicio: tras agotar los reintentos por conflicto responde 409 y los documentos ya purgados no vuelven', async () => {
  const w = new World();
  await withDocs(w);
  const real = w.deps.updateContentAsUser;
  w.deps.updateContentAsUser = () => Promise.resolve(null);
  const res = await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_B, confirm: true, expectedCount: 1 });
  assertEquals([res.status, res.body.code], [409, 'content_conflict']);
  w.deps.updateContentAsUser = real;
  // Reintentar ahora funciona (el servicio ya no tiene documentos).
  assertEquals((await w.call('admin-token', { action: 'remove-service', proposalId: P1, serviceId: SVC_B })).status, 200);
});

Deno.test('borrar día con documentos: exige confirmación, purga los de TODOS sus servicios, renumera y respeta el resto', async () => {
  const w = new World();
  await withDocs(w);
  const ask = await w.call('admin-token', { action: 'remove-day', proposalId: P1, dayId: 'day-1' });
  assertEquals([ask.status, ask.body.code, ask.body.attachmentCount], [409, 'confirmation_required', 3]);
  assertEquals(w.rows.length, 5);

  const res = await w.call('admin-token', { action: 'remove-day', proposalId: P1, dayId: 'day-1', confirm: true, expectedCount: 3 });
  assertEquals([res.status, res.body.deletedDocuments], [200, 3]);
  assertEquals(contentOf(w).days.map((d) => [d.id, d.dayNumber]), [['day-2', 1]]);
  assertEquals(w.rows.map((r) => r.file_name).sort(), ['otra-propuesta.pdf', 'otro-dia.pdf']);
  assertEquals((await w.call('admin-token', { action: 'remove-day', proposalId: P1, dayId: 'no-existe' })).status, 404);
});

// ---------------------------------------------------------------- eliminar la propuesta

Deno.test('purge-proposal: solo admin; borra todos los documentos de esa propuesta y no los de otras', async () => {
  const w = new World();
  await withDocs(w);
  // La Asesora gestiona propuestas pero no es admin (y además no ve P1).
  assertEquals((await w.call('advisor-token', { action: 'purge-proposal', proposalId: P2 })).status, 403);
  assertEquals(w.rows.length, 5);
  const res = await w.call('admin-token', { action: 'purge-proposal', proposalId: P1 });
  assertEquals([res.status, res.body.deletedDocuments], [200, 4]);
  assertEquals(w.rows.map((r) => r.file_name), ['otra-propuesta.pdf']);
  assertEquals(w.objects.size, 1);
});

Deno.test('purge-proposal: si Storage falla responde 502 (para abortar la eliminación) y la fila se conserva', async () => {
  const w = new World();
  await withDocs(w);
  w.failRemove.add(w.rows[0].storage_path);
  const res = await w.call('admin-token', { action: 'purge-proposal', proposalId: P1 });
  assertEquals([res.status, res.body.code], [502, 'storage_failed']);
  assert(w.rows.some((r) => r.storage_path === [...w.failRemove][0]));
});
