// Prueba de PUNTA A PUNTA de send-proposal (handleRequest completo: CORS, JWT, permisos, lectura, envío y escrituras) con
// Supabase y Resend falsos. Garantiza que un itinerario se rechaza con 409 y CERO efectos secundarios.
import { assertEquals } from 'jsr:@std/assert@1';
import { FakeSupabase } from '../_shared/fake-supabase.ts';
import { handleRequest } from './handler.ts';

const P = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';

const base = { public_token: 'tok-1', lead_id: 'lead-1', client_name: 'Ana Pérez', client_email: 'ana@example.com', access_required: true, advisor_id: 'adv-1' };

function world() {
  const service = new FakeSupabase();
  service.tables.proposals = [
    { id: P, kind: 'proposal', status: 'published', ...base },
    { id: I, kind: 'itinerary', status: 'shared', ...base, public_token: 'tok-2' }
  ];
  service.tables.leads = [{ id: 'lead-1', name: 'Ana Pérez', email: 'ana@example.com', status: 'nueva' }];
  // El cliente del USUARIO (RLS): ve ambos registros y tiene permiso de gestión.
  const caller = new FakeSupabase();
  caller.tables.proposals = [{ id: P, kind: 'proposal' }, { id: I, kind: 'itinerary' }];
  caller.rpcResults['can_manage_proposals'] = true;
  const createClient = ((_url: string, key: string) => (key === 'anon-key' ? caller : service)) as never;
  return { service, caller, deps: { createClient } };
}

/** Ejecuta `fn` con Deno.env y fetch (Resend) controlados, y devuelve las llamadas a fetch. */
async function withEnv<T>(fn: (resendCalls: string[]) => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const keys = { SUPABASE_URL: 'http://db.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 're_test', ...env };
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

const call = (w: ReturnType<typeof world>, proposalId: string, token: string | null = 'jwt') =>
  handleRequest(
    new Request('https://x.test/functions/v1/send-proposal', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ mode: 'proposal', proposalId })
    }),
    w.deps
  ).then(async (res) => ({ status: res.status, body: await res.json() }));

Deno.test('send-proposal: un ITINERARIO se rechaza con 409 KIND_NOT_SUPPORTED y cero efectos secundarios', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    const res = await call(w, I);
    assertEquals([res.status, res.body.code], [409, 'KIND_NOT_SUPPORTED']);
    assertEquals(resendCalls, [], 'no se llamó a Resend (ningún correo)');
    assertEquals(w.service.writes, [], 'service_role no escribió nada (ni leads ni audit_log)');
    assertEquals(w.caller.writes, []);
    assertEquals(w.service.authAdminCalls, [], 'no se resolvió el correo de la asesora');
    // Ni siquiera leyó con service_role: se cortó con la lectura RLS del usuario.
    assertEquals(w.service.rpcCalls, []);
  }));

Deno.test('send-proposal: el itinerario sigue rechazado aunque esté compartido, visto o en borrador', () =>
  withEnv(async (resendCalls) => {
    for (const status of ['draft', 'shared', 'viewed']) {
      const w = world();
      w.service.tables.proposals[1].status = status;
      const res = await call(w, I);
      assertEquals([res.status, res.body.code], [409, 'KIND_NOT_SUPPORTED'], status);
      assertEquals(w.service.writes, []);
    }
    assertEquals(resendCalls, []);
  }));

Deno.test('send-proposal: sin sesión → 401 y nada se envía', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    assertEquals((await call(w, P, null)).status, 401);
    w.caller.user = null;
    assertEquals((await call(w, P)).status, 401);
    assertEquals([resendCalls, w.service.writes], [[], []]);
  }));

Deno.test('send-proposal: sin permiso de gestión → 403 y nada se envía', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    w.caller.rpcResults['can_manage_proposals'] = false;
    assertEquals((await call(w, P)).status, 403);
    assertEquals([resendCalls, w.service.writes], [[], []]);
  }));

Deno.test('send-proposal: control — una PROPUESTA publicada se envía (1 correo, lead y auditoría actualizados)', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    const res = await call(w, P);
    assertEquals([res.status, res.body.ok, res.body.sentTo], [200, true, 'ana@example.com']);
    assertEquals(resendCalls, ['https://api.resend.com/emails']);
    assertEquals(w.service.writes, ['update leads', 'insert audit_log']);
  }));

Deno.test('send-proposal: control — una propuesta en borrador sigue dando 400 INVALID_STATUS (el flujo de propuestas no cambió)', () =>
  withEnv(async (resendCalls) => {
    const w = world();
    w.service.tables.proposals[0].status = 'draft';
    const res = await call(w, P);
    assertEquals([res.status, res.body.code], [400, 'INVALID_STATUS']);
    assertEquals([resendCalls, w.service.writes], [[], []]);
  }));
