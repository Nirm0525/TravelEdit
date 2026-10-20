import { BLOB_URL_LIFETIME_MS, resolveViewableUrl } from './open-document';

const SIGNED = 'https://storage.test/sign/doc?token=abc';
const okResponse = (body: string) => new Response(body, { status: 200, headers: { 'content-type': 'text/plain' } });

describe('resolveViewableUrl', () => {
  it('baja el archivo y devuelve un blob: con el tipo ya validado por el servidor (no el que diga Storage)', async () => {
    let seen: Blob | null = null;
    const url = await resolveViewableUrl(SIGNED, 'application/pdf', {
      fetch: (async () => okResponse('%PDF-1.4')) as unknown as typeof fetch,
      createObjectURL: (blob) => {
        seen = blob;
        return 'blob:https://app.test/123';
      },
      schedule: () => undefined
    });
    expect(url).toBe('blob:https://app.test/123');
    expect(seen!.type).toBe('application/pdf');
    expect(await seen!.text()).toBe('%PDF-1.4');
  });

  it('libera el blob pasado un rato', async () => {
    const revoked: string[] = [];
    const timers: { fn: () => void; ms: number }[] = [];
    await resolveViewableUrl(SIGNED, 'image/png', {
      fetch: (async () => okResponse('x')) as unknown as typeof fetch,
      createObjectURL: () => 'blob:x',
      revokeObjectURL: (u) => revoked.push(u),
      schedule: (fn, ms) => timers.push({ fn, ms })
    });
    expect(timers.length).toBe(1);
    expect(timers[0].ms).toBe(BLOB_URL_LIFETIME_MS);
    timers[0].fn();
    expect(revoked).toEqual(['blob:x']);
  });

  it('si no se puede bajar (HTTP de error o red caída) devuelve la URL firmada para abrirla directo', async () => {
    const make = (f: () => Promise<Response>) => ({ fetch: f as unknown as typeof fetch, createObjectURL: () => 'blob:never', schedule: () => undefined });
    expect(await resolveViewableUrl(SIGNED, 'application/pdf', make(async () => new Response('no', { status: 403 })))).toBe(SIGNED);
    expect(await resolveViewableUrl(SIGNED, 'application/pdf', make(async () => Promise.reject(new TypeError('Failed to fetch'))))).toBe(SIGNED);
  });
});
