import { assert, assertEquals, assertFalse, assertMatch } from 'jsr:@std/assert@1';
import {
  MAX_FILE_BYTES,
  buildStoragePath,
  isSafeServiceId,
  parseStoragePath,
  sanitizeDisplayName,
  serviceExists,
  serviceIdsOfDay,
  sniffKind,
  validateUploadRequest,
  withoutDay,
  withoutService
} from './service-attachment-rules.ts';

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';

const bytes = (...b: number[]) => new Uint8Array(b);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34);
const JPEG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10);
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0);
const WEBP = bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50);

Deno.test('reglas: acepta PDF, JPEG, PNG y WebP con su extensión', () => {
  for (const [name, mime, kind] of [
    ['Boleto.pdf', 'application/pdf', 'pdf'],
    ['foto.JPG', 'image/jpeg', 'jpeg'],
    ['foto.jpeg', 'image/jpeg', 'jpeg'],
    ['captura.png', 'image/png', 'png'],
    ['voucher.webp', 'image/webp', 'webp']
  ] as const) {
    assertEquals(validateUploadRequest({ fileName: name, mimeType: mime, fileSize: 1000 }), { ok: true, kind });
  }
});

Deno.test('reglas: MIME no permitido, extensión que no coincide, vacío y demasiado grande', () => {
  const ok = { fileName: 'a.pdf', mimeType: 'application/pdf', fileSize: 10 };
  for (const mime of ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/svg+xml', 'image/gif', 'text/html', '', undefined]) {
    assertEquals(validateUploadRequest({ ...ok, mimeType: mime }), { ok: false, error: 'invalid_mime' }, String(mime));
  }
  for (const name of ['a.docx', 'a.exe', 'a', 'a.pdf.exe', 'a.png']) {
    assertEquals(validateUploadRequest({ ...ok, fileName: name }), { ok: false, error: 'invalid_extension' }, name);
  }
  assertEquals(validateUploadRequest({ ...ok, fileSize: 0 }), { ok: false, error: 'empty_file' });
  assertEquals(validateUploadRequest({ ...ok, fileSize: MAX_FILE_BYTES }), { ok: true, kind: 'pdf' });
  assertEquals(validateUploadRequest({ ...ok, fileSize: MAX_FILE_BYTES + 1 }), { ok: false, error: 'too_large' });
  for (const size of [-1, 1.5, NaN, '10', null]) {
    assertEquals(validateUploadRequest({ ...ok, fileSize: size }), { ok: false, error: 'invalid_size' }, String(size));
  }
  assertEquals(validateUploadRequest({ ...ok, fileName: '  ' }), { ok: false, error: 'invalid_name' });
});

Deno.test('reglas: el tipo real sale de los primeros bytes', () => {
  assertEquals(sniffKind(PDF), 'pdf');
  assertEquals(sniffKind(JPEG), 'jpeg');
  assertEquals(sniffKind(PNG), 'png');
  assertEquals(sniffKind(WEBP), 'webp');
  assertEquals(sniffKind(new TextEncoder().encode('<html><script>alert(1)</script>')), null);
  assertEquals(sniffKind(new TextEncoder().encode('PK\u0003\u0004 docx')), null);
  assertEquals(sniffKind(new Uint8Array()), null);
  // RIFF que no es WebP (p. ej. WAV)
  assertEquals(sniffKind(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)), null);
});

Deno.test('reglas: el nombre para mostrar se limpia y siempre lleva la extensión del tipo real', () => {
  assertEquals(sanitizeDisplayName('Boleto aéreo CM385.pdf', 'pdf'), 'Boleto aéreo CM385.pdf');
  assertEquals(sanitizeDisplayName('C:\\Users\\x\\..\\boleto.pdf', 'pdf'), 'boleto.pdf');
  assertEquals(sanitizeDisplayName('../../etc/passwd', 'pdf'), 'passwd.pdf');
  assertEquals(sanitizeDisplayName('voucher\u0000\u0007.pdf', 'pdf'), 'voucher .pdf');
  assertEquals(sanitizeDisplayName('foto.jpeg', 'jpeg'), 'foto.jpeg');
  assertEquals(sanitizeDisplayName('foto.png', 'jpeg'), 'foto.png.jpg');
  assertEquals(sanitizeDisplayName('   ', 'png'), 'documento.png');
  assertEquals(sanitizeDisplayName(undefined, 'webp'), 'documento.webp');
  const long = sanitizeDisplayName('a'.repeat(500) + '.pdf', 'pdf');
  assert(long.length <= 200 && long.endsWith('.pdf'));
});

Deno.test('reglas: la ruta de Storage es aleatoria, no usa el nombre original y se puede leer de vuelta', () => {
  const a = buildStoragePath(P, S, 'pdf');
  const b = buildStoragePath(P, S, 'pdf');
  assert(a !== b);
  assertMatch(a, /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/);
  assertEquals(parseStoragePath(a)?.proposalId, P);
  assertEquals(parseStoragePath(a)?.serviceId, S);
  assertEquals(parseStoragePath(buildStoragePath(P, S, 'jpeg'))?.kind, 'jpeg');
});

Deno.test('reglas: rutas manipuladas no se aceptan', () => {
  for (const path of [
    `${P}/${S}/../${P}/${S}/x.pdf`,
    `${P}/${S}/boleto.pdf`,
    `${P}/${S}/${crypto.randomUUID()}.exe`,
    `${P}/${S}/${crypto.randomUUID()}.pdf/extra`,
    `/${P}/${S}/${crypto.randomUUID()}.pdf`,
    `${P}//${crypto.randomUUID()}.pdf`,
    `otro/${S}/${crypto.randomUUID()}.pdf`,
    `${P}/${S}/${crypto.randomUUID()}.PDF.svg`,
    null,
    42
  ]) {
    assertEquals(parseStoragePath(path), null, String(path));
  }
  assert(isSafeServiceId(S));
  for (const id of ['', 'a/b', '..', 'a b', 'x'.repeat(65), undefined]) {
    assertFalse(isSafeServiceId(id), String(id));
  }
});

const content = () => ({
  cover: { title: 'X' },
  days: [
    { id: 'd1', dayNumber: 1, title: 'Uno', services: [{ id: 's1' }, { id: 's2' }] },
    { id: 'd2', dayNumber: 2, title: 'Dos', services: [{ id: 's3' }] },
    { id: 'd3', dayNumber: 3, title: 'Tres', services: [] }
  ]
});

Deno.test('contenido: serviceExists solo mira esta propuesta y, si se indica, ese día', () => {
  assert(serviceExists(content(), 's3'));
  assert(serviceExists(content(), 's3', 'd2'));
  assertFalse(serviceExists(content(), 's3', 'd1'));
  assertFalse(serviceExists(content(), 'nope'));
  assertFalse(serviceExists('{"days":[]}', 's1'));
  assertFalse(serviceExists(null, 's1'));
  assertEquals(serviceIdsOfDay(content(), 'd1'), ['s1', 's2']);
  assertEquals(serviceIdsOfDay(content(), 'nope'), null);
});

Deno.test('contenido: quitar un servicio o un día deja el resto intacto (y renumera los días)', () => {
  const noService = withoutService(content(), 's2') as ReturnType<typeof content>;
  assertEquals(noService.days[0].services, [{ id: 's1' }]);
  assertEquals(noService.days[1], content().days[1]);
  assertEquals(noService.cover, { title: 'X' });

  const noDay = withoutDay(content(), 'd1') as ReturnType<typeof content>;
  assertEquals(noDay.days.map((d) => [d.id, d.dayNumber]), [['d2', 1], ['d3', 2]]);
  assertEquals(noDay.cover, { title: 'X' });
});
