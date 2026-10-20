import { assert, assertEquals } from 'jsr:@std/assert@1';
import { inspectObjectAtUrl, totalFromContentRange } from './object-inspect.ts';
import { MAX_FILE_BYTES, sniffKind } from './service-attachment-rules.ts';

const PDF_HEAD = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0, 0, 0, 0, 0, 0, 0]);

/** Respuesta falsa; el cuerpo es un flujo del que se cuenta cuántos bytes se leyeron y si se canceló. */
function fakeResponse(status: number, headers: Record<string, string>, chunks: Uint8Array[]) {
  const stats = { pulled: 0, cancelled: false };
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      const chunk = chunks[i++];
      stats.pulled += chunk.length;
      controller.enqueue(chunk);
    },
    cancel() {
      stats.cancelled = true;
    }
  });
  return { res: new Response(body, { status, headers }), stats };
}

const fetchReturning = (res: Response, seen: { range?: string | null } = {}): typeof fetch =>
  ((_url: string, init?: RequestInit) => {
    seen.range = new Headers(init?.headers).get('range');
    return Promise.resolve(res);
  }) as unknown as typeof fetch;

Deno.test('Content-Range: el total sale de lo que informa el servidor', () => {
  assertEquals(totalFromContentRange('bytes 0-15/12345'), 12345);
  assertEquals(totalFromContentRange('bytes */0'), 0);
  assertEquals(totalFromContentRange('bytes 0-15/*'), null);
  assertEquals(totalFromContentRange(null), null);
  assertEquals(totalFromContentRange('items 0-1/5'), null);
});

Deno.test('inspección: 206 con Content-Range da el tamaño real del objeto y sus primeros bytes', async () => {
  const seen: { range?: string | null } = {};
  const { res } = fakeResponse(206, { 'content-range': 'bytes 0-15/2048576' }, [PDF_HEAD]);
  const out = await inspectObjectAtUrl('https://s.test/x', 16, fetchReturning(res, seen));
  assertEquals(seen.range, 'bytes=0-15');
  assert(out.status === 'ok');
  assertEquals(out.size, 2048576);
  assertEquals(sniffKind(out.head), 'pdf');
});

Deno.test('inspección: el tamaño es el REAL aunque el navegador dijera menos (un objeto > 10 MB se ve > 10 MB)', async () => {
  const { res } = fakeResponse(206, { 'content-range': `bytes 0-15/${MAX_FILE_BYTES + 1}` }, [PDF_HEAD]);
  const out = await inspectObjectAtUrl('https://s.test/x', 16, fetchReturning(res));
  assert(out.status === 'ok' && out.size > MAX_FILE_BYTES);
});

Deno.test('inspección: si el servidor IGNORA Range (200) no se descarga el archivo: se usa Content-Length y se corta la lectura', async () => {
  const MB = new Uint8Array(1024 * 1024);
  MB.set(PDF_HEAD);
  // 10 MB en trozos de 1 MB: leerlo entero sería un descuido caro.
  const chunks = Array.from({ length: 10 }, (_, i) => (i === 0 ? MB : new Uint8Array(1024 * 1024)));
  const { res, stats } = fakeResponse(200, { 'content-length': String(10 * 1024 * 1024) }, chunks);
  const out = await inspectObjectAtUrl('https://s.test/x', 16, fetchReturning(res));
  assert(out.status === 'ok');
  assertEquals(out.size, 10 * 1024 * 1024);
  assertEquals(out.head.length, 16);
  assertEquals(sniffKind(out.head), 'pdf');
  assert(stats.cancelled, 'la lectura se cancela');
  assert(stats.pulled <= 2 * 1024 * 1024, `solo se leyó lo necesario (${stats.pulled} bytes)`);
});

Deno.test('inspección: 200 sin Content-Length → no se sabe el tamaño → error (falla cerrado)', async () => {
  const { res, stats } = fakeResponse(200, {}, [PDF_HEAD]);
  const out = await inspectObjectAtUrl('https://s.test/x', 16, fetchReturning(res));
  assertEquals(out.status, 'error');
  assert(stats.cancelled);
});

Deno.test('inspección: 206 sin Content-Range válido → error', async () => {
  const { res } = fakeResponse(206, { 'content-range': 'bytes 0-15/*' }, [PDF_HEAD]);
  assertEquals((await inspectObjectAtUrl('https://s.test/x', 16, fetchReturning(res))).status, 'error');
});

Deno.test('inspección: 404 → missing; 416 con bytes */0 → objeto vacío; otros códigos → error; red caída → error', async () => {
  assertEquals((await inspectObjectAtUrl('u', 16, fetchReturning(fakeResponse(404, {}, []).res))).status, 'missing');
  const empty = await inspectObjectAtUrl('u', 16, fetchReturning(fakeResponse(416, { 'content-range': 'bytes */0' }, []).res));
  assert(empty.status === 'ok' && empty.size === 0 && empty.head.length === 0);
  assertEquals((await inspectObjectAtUrl('u', 16, fetchReturning(fakeResponse(416, {}, []).res))).status, 'error');
  assertEquals((await inspectObjectAtUrl('u', 16, fetchReturning(fakeResponse(500, {}, []).res))).status, 'error');
  const down = (() => Promise.reject(new Error('red'))) as unknown as typeof fetch;
  assertEquals((await inspectObjectAtUrl('u', 16, down)).status, 'error');
});

Deno.test('inspección: JPEG, PNG y WebP se reconocen por sus primeros bytes', async () => {
  const heads: [string, number[]][] = [
    ['jpeg', [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1]],
    ['png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52]],
    ['webp', [0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]]
  ];
  for (const [kind, bytes] of heads) {
    const { res } = fakeResponse(206, { 'content-range': 'bytes 0-15/5000' }, [new Uint8Array(bytes)]);
    const out = await inspectObjectAtUrl('u', 16, fetchReturning(res));
    assert(out.status === 'ok');
    assertEquals(sniffKind(out.head), kind);
  }
});
