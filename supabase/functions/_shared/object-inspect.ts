// Inspección de un objeto recién subido a Storage: tamaño REAL y primeros bytes, con UNA petición `Range` sobre una URL
// firmada de lectura. Nunca confía en el tamaño que declaró el navegador ni en el MIME.
//
// Por qué así y no con storage.list(): list() devuelve metadata de la tabla storage.objects (útil, pero es otro endpoint,
// paginado y con búsqueda por prefijo) y no prueba que los bytes sean legibles. Una petición Range a la URL firmada
// da, en una sola llamada, el tamaño total que informa el servidor de objetos (Content-Range: bytes 0-15/TOTAL) y los
// bytes iniciales para comprobar el tipo real.
//
// Si el servidor IGNORA Range (responde 200 con el archivo completo) no se descarga: se usa Content-Length para el tamaño,
// se leen solo los primeros bytes del flujo y se cancela la lectura. Si no se puede determinar el tamaño con certeza, el
// resultado es 'error' (falla cerrado): el llamador no acepta el archivo.

export type InspectResult =
  | { status: 'ok'; size: number; head: Uint8Array }
  | { status: 'missing' }
  | { status: 'error'; reason: string };

/** Content-Range: bytes 0-15/12345 → 12345; "*" o formato raro → null. */
export function totalFromContentRange(header: string | null): number | null {
  const m = /^bytes\s+(?:\d+-\d+|\*)\/(\d+)$/i.exec((header ?? '').trim());
  return m ? Number(m[1]) : null;
}

async function readHead(body: ReadableStream<Uint8Array> | null, bytes: number): Promise<Uint8Array> {
  if (!body) {
    return new Uint8Array();
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  try {
    while (received < bytes) {
      const { done, value } = await reader.read();
      if (done || !value) {
        break;
      }
      chunks.push(value);
      received += value.length;
    }
  } finally {
    // Corta la descarga: aunque el servidor ignore Range, no se baja el archivo completo.
    await reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(received, bytes));
  let offset = 0;
  for (const chunk of chunks) {
    const take = Math.min(chunk.length, out.length - offset);
    out.set(chunk.subarray(0, take), offset);
    offset += take;
    if (offset >= out.length) {
      break;
    }
  }
  return out;
}

export async function inspectObjectAtUrl(
  url: string,
  headBytes: number,
  doFetch: typeof fetch = fetch
): Promise<InspectResult> {
  let res: Response;
  try {
    res = await doFetch(url, { headers: { Range: `bytes=0-${headBytes - 1}` } });
  } catch (err) {
    return { status: 'error', reason: `fetch: ${(err as Error).message}` };
  }

  if (res.status === 404) {
    await res.body?.cancel().catch(() => undefined);
    return { status: 'missing' };
  }
  if (res.status === 416) {
    // Range no satisfacible: un objeto de 0 bytes. Content-Range: bytes */0
    await res.body?.cancel().catch(() => undefined);
    return totalFromContentRange(res.headers.get('content-range')) === 0 ? { status: 'ok', size: 0, head: new Uint8Array() } : { status: 'error', reason: 'range 416' };
  }
  if (res.status === 206) {
    const total = totalFromContentRange(res.headers.get('content-range'));
    if (total === null) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 'error', reason: 'content-range ausente o inválido' };
    }
    return { status: 'ok', size: total, head: await readHead(res.body, headBytes) };
  }
  if (res.status === 200) {
    // El servidor ignoró Range: el tamaño sale de Content-Length (sin descargar) y solo se leen los primeros bytes.
    const length = res.headers.get('content-length');
    const size = length !== null && /^\d+$/.test(length) ? Number(length) : null;
    if (size === null) {
      await res.body?.cancel().catch(() => undefined);
      return { status: 'error', reason: 'tamaño desconocido (sin content-range ni content-length)' };
    }
    return { status: 'ok', size, head: await readHead(res.body, headBytes) };
  }
  await res.body?.cancel().catch(() => undefined);
  return { status: 'error', reason: `http ${res.status}` };
}
