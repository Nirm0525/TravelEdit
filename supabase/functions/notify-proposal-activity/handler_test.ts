// Prueba de PUNTA A PUNTA de notify-proposal-activity (handleRequest completo) con Supabase y Resend falsos.
// Garantiza que un itinerario se rechaza con 409 y CERO efectos secundarios.
import { assertEquals } from 'jsr:@std/assert@1';
import { FakeSupabase } from '../_shared/fake-supabase.ts';
import { handleRequest } from './handler.ts';

const P = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';

const base = {
  client_name: 'Ana Pérez', title: 'Viaje', content: { days: [{ dayNumber: 1, title: 'Uno', services: [{ id: 'svc-1', title: 'Hotel' }] }] },
  advisor_id: 'adv-1', service_comments: { 'svc-1': 'Cambiar la fecha' }, accepted_by_name: 'Ana', feedback_sent_at: null, accepted_notified_at: null
};

function world() {
  const db = new FakeSupabase();
  db.tables.proposals = [
    { id: P, kind: 'proposal', public_token: 'tok-p', status: 'accepted', ...base },
    { id: I, kind: 'itinerary', public_token: 'tok-i', status: 'shared', ...base }
  ];
  db.tables.proposal_access_sessions = [
    { id: 'sess-p', proposal_id: P, expires_at: '2999-01-01T00:00:00Z' },
    { id: 'sess-i', proposal_id: I, expires_at: '2999-01-01T00:00:00Z' }
  ];
  db.tables.profiles = [{ id: 'adv-1', full_name: 'Asesora Demo' }];
  return { db, deps: { createClient: (() => db) as never } };
}

async function withEnv<T>(fn: (resendCalls: string[]) => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const keys = { SUPABASE_URL: 'http://db.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 're_test', ...env };
  for (const [k, v] of Object.entries(keys)) Deno.env.set(k, v);
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = ((input: unknown) => {
    calls.push(String(input));
    return Promise.resolve(new Response('{}', { status: 200 }));
  }) as typeof fetch;
  try {
    return await fn(calls);
  } finally {
    globalThis.fetch = original;
    for (const k of Object.keys(keys)) Deno.env.delete(k);
  }
}

const call = (w: ReturnType<typeof world>, body: Record<string, unknown>) =>
  handleRequest(
    new Request('https://x.test/functions/v1/notify-proposal-activity', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    w.deps
  ).then(async (res) => ({ status: res.status, body: await res.json() }));

for (const event of ['feedback', 'accepted']) {
  Deno.test(`notify-proposal-activity: un ITINERARIO con event=${event} → 409 kind_not_supported y cero efectos secundarios`, () =>
    withEnv(async (resendCalls) => {
      const w = world();
      const res = await call(w, { token: 'tok-i', sessionToken: 'sess-i', event });
      assertEquals([res.status, res.body.code], [409, 'kind_not_supported']);
      assertEquals(resendCalls, [], 'no se llamó a Resend (ningún correo)');
      assertEquals(w.db.writes, [], 'no se marcó feedback_sent_at ni accepted_notified_at');
      assertEquals(w.db.authAdminCalls, [], 'no se resolvió el correo de la asesora');
    }));
}

Deno.test('notify-proposal-activity: el itinerario sigue rechazado en cualquier estado', () =>
  withEnv(async (resendCalls) => {
    for (const status of ['draft', 'shared', 'viewed', 'accepted']) {
      const w = world();
      w.db.tables.proposals[1].status = status;
      const res = await call(w, { token: 'tok-i', sessionToken: 'sess-i', event: 'feedback' });
      assertEquals(res.status, 409, status);
      assertEquals(w.db.writes, []);
    }
    assertEquals(resendCalls, []);
  }));

Deno.test('notify-proposal-activity: solicitud inválida → 400; sesión de otro registro → 404 (no revela el tipo)', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    assertEquals((await call(w, { token: 'tok-p', event: 'feedback' })).status, 400);
    assertEquals((await call(w, { token: 'tok-p', sessionToken: 'sess-i', event: 'feedback' })).status, 404);
    assertEquals((await call(w, { token: 'tok-p', sessionToken: 'nope', event: 'feedback' })).status, 401);
    assertEquals([resendCalls, w.db.writes], [[], []]);
  }));

Deno.test('notify-proposal-activity: control — una PROPUESTA aceptada avisa al equipo (1 correo) y marca accepted_notified_at', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    const res = await call(w, { token: 'tok-p', sessionToken: 'sess-p', event: 'accepted' });
    assertEquals([res.status, res.body.ok], [200, true]);
    assertEquals(resendCalls, ['https://api.resend.com/emails']);
    assertEquals(w.db.writes, ['update proposals']);
  }));

Deno.test('notify-proposal-activity: control — feedback de una propuesta sin comentarios sigue dando 400', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    w.db.tables.proposals[0].service_comments = {};
    const res = await call(w, { token: 'tok-p', sessionToken: 'sess-p', event: 'feedback' });
    assertEquals(res.status, 400);
    assertEquals([resendCalls, w.db.writes], [[], []]);
  }));
