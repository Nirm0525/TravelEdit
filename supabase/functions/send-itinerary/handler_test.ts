// Prueba de PUNTA A PUNTA de send-itinerary (handleRequest completo: JWT, visibilidad, permiso, propiedad, estado, destinatario,
// envío y auditoría) con Supabase y Resend falsos. Garantiza que un fallo no envía ni escribe nada.
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { FakeSupabase } from '../_shared/fake-supabase.ts';
import { handleRequest } from './handler.ts';
import { buildItineraryEmail } from './itinerary-email.ts';

const I = '22222222-2222-4222-8222-222222222222';
const I_DRAFT = '33333333-3333-4333-8333-333333333333';
const P = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2027-01-10T12:00:00Z');

const base = { public_token: 'tok-itin', client_name: 'Ana Pérez', client_email: 'ana@example.com', access_required: true, advisor_id: 'adv-1', expires_at: null };

function world() {
  const service = new FakeSupabase();
  service.tables.proposals = [
    { id: I, kind: 'itinerary', status: 'shared', ...base },
    { id: I_DRAFT, kind: 'itinerary', status: 'draft', ...base, public_token: 'tok-draft' },
    { id: P, kind: 'proposal', status: 'published', ...base, public_token: 'tok-prop' }
  ];
  // El cliente del USUARIO (RLS): ve los tres registros y puede compartir.
  const caller = new FakeSupabase();
  caller.tables.proposals = [
    { id: I, kind: 'itinerary', advisor_id: 'adv-1' },
    { id: I_DRAFT, kind: 'itinerary', advisor_id: 'adv-1' },
    { id: P, kind: 'proposal', advisor_id: 'adv-1' }
  ];
  caller.rpcResults['can_travel'] = true;
  caller.rpcResults['is_own_or_full'] = true;
  const resend: { url: string; body: Record<string, any> }[] = [];
  let resendStatus = 200;
  const fetchImpl = ((url: string, init: RequestInit) => {
    resend.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Promise.resolve(new Response('{}', { status: resendStatus }));
  }) as unknown as typeof fetch;
  const createClient = ((_url: string, key: string) => (key === 'anon-key' ? caller : service)) as never;
  return { service, caller, resend, setResendStatus: (s: number) => (resendStatus = s), deps: { createClient, fetchImpl, now: () => NOW } };
}

async function withEnv<T>(fn: () => Promise<T>, env: Record<string, string> = {}): Promise<T> {
  const keys = { SUPABASE_URL: 'http://db.test', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', RESEND_API_KEY: 're_test', ...env };
  for (const [k, v] of Object.entries(keys)) Deno.env.set(k, v);
  try {
    return await fn();
  } finally {
    for (const k of Object.keys(keys)) Deno.env.delete(k);
  }
}

const call = (w: ReturnType<typeof world>, body: unknown, token: string | null = 'jwt') =>
  handleRequest(
    new Request('https://x.test/functions/v1/send-itinerary', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    }),
    w.deps
  ).then(async (res) => ({ status: res.status, body: await res.json() }));

const noSideEffects = (w: ReturnType<typeof world>) => {
  assertEquals(w.resend, [], 'no se llamó a Resend');
  assertEquals([w.service.writes, w.caller.writes], [[], []], 'no se escribió nada');
};

Deno.test('send-itinerary: un itinerario COMPARTIDO se envía (1 correo al correo del cliente, con el enlace oficial) y se audita', () =>
  withEnv(async () => {
    const w = world();
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.ok, res.body.sentTo], [200, true, 'ana@example.com']);
    assertEquals(w.resend.length, 1);
    assertEquals(w.resend[0].url, 'https://api.resend.com/emails');
    const mail = w.resend[0].body;
    assertEquals(mail.to, ['ana@example.com']);
    assertEquals(mail.reply_to, 'asesora@example.com');
    assertStringIncludes(mail.html, 'https://thetravel-edit.com/private/tok-itin');
    assertStringIncludes(mail.text, 'https://thetravel-edit.com/private/tok-itin');
    assertEquals(mail.subject, 'Tu itinerario de viaje está listo');
    // Auditoría propia del itinerario, sin tocar solicitudes ni propuestas.
    assertEquals(w.service.writes, ['insert audit_log']);
    assertEquals(w.service.inserted[0].row, { entity_type: 'itinerary', entity_id: I, actor_id: 'user-1', action: 'itinerary_email_sent', summary: 'Itinerario enviado a ana@example.com' });
  }));

Deno.test('send-itinerary: un itinerario VISTO también se puede (re)enviar', () =>
  withEnv(async () => {
    const w = world();
    w.service.tables.proposals[0].status = 'viewed';
    assertEquals((await call(w, { itineraryId: I })).status, 200);
    assertEquals(w.resend.length, 1);
  }));

Deno.test('send-itinerary: el correo NO lleva precios, inversión, términos, aceptación ni lenguaje de propuesta', () =>
  withEnv(async () => {
    const w = world();
    await call(w, { itineraryId: I });
    const text = `${w.resend[0].body.subject} ${w.resend[0].body.html} ${w.resend[0].body.text}`.toLowerCase();
    for (const banned of ['propuesta', 'precio', 'inversión', 'inversion', 'cotiz', 'términos', 'terminos', 'condiciones', 'aceptar', 'usd', 'total']) {
      assertFalse(text.includes(banned), banned);
    }
  }));

Deno.test('send-itinerary: con acceso protegido avisa de que hay código pero NO lo incluye; sin acceso protegido no menciona código', () => {
  const protectedMail = buildItineraryEmail({ clientName: 'Ana Pérez', privateUrl: 'https://thetravel-edit.com/private/t', accessRequired: true });
  assertStringIncludes(protectedMail.html, 'código de acceso');
  assertStringIncludes(protectedMail.text, 'código de acceso');
  assertFalse(/TRV-/.test(protectedMail.html + protectedMail.text));
  const open = buildItineraryEmail({ clientName: 'Ana Pérez', privateUrl: 'https://thetravel-edit.com/private/t', accessRequired: false });
  assertFalse((open.html + open.text).toLowerCase().includes('código'));
});

Deno.test('send-itinerary: el nombre del cliente se escapa en el HTML', () => {
  const mail = buildItineraryEmail({ clientName: '<script>alert(1)</script> Ana', privateUrl: 'https://thetravel-edit.com/private/t?a=1&b=2', accessRequired: false });
  assertFalse(mail.html.includes('<script>'));
  assertStringIncludes(mail.html, '&amp;b=2');
});

Deno.test('send-itinerary: un itinerario en BORRADOR se rechaza (400 INVALID_STATUS) sin enviar ni escribir', () =>
  withEnv(async () => {
    const w = world();
    const res = await call(w, { itineraryId: I_DRAFT });
    assertEquals([res.status, res.body.code], [400, 'INVALID_STATUS']);
    noSideEffects(w);
  }));

Deno.test('send-itinerary: una PROPUESTA se rechaza (409 KIND_NOT_SUPPORTED) sin enviar ni escribir ni leer con service_role', () =>
  withEnv(async () => {
    const w = world();
    const reads: string[] = [];
    const from = w.service.from.bind(w.service);
    w.service.from = ((t: string) => (reads.push(t), from(t))) as never;
    const res = await call(w, { itineraryId: P });
    assertEquals([res.status, res.body.code], [409, 'KIND_NOT_SUPPORTED']);
    assertEquals(reads, []);
    noSideEffects(w);
  }));

Deno.test('send-itinerary: el tipo se revalida con la lectura de service_role (defensa en profundidad)', () =>
  withEnv(async () => {
    const w = world();
    w.service.tables.proposals[0].kind = 'proposal'; // la lectura RLS aún dice itinerary
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.code], [409, 'KIND_NOT_SUPPORTED']);
    noSideEffects(w);
  }));

Deno.test('send-itinerary: autorización — sin sesión, sin visibilidad, sin permiso de compartir o de otra asesora', () =>
  withEnv(async () => {
    let w = world();
    assertEquals((await call(w, { itineraryId: I }, null)).status, 401);
    w = world();
    w.caller.user = null;
    assertEquals((await call(w, { itineraryId: I })).status, 401);
    noSideEffects(w);

    w = world();
    w.caller.tables.proposals = []; // RLS: el usuario no lo ve
    assertEquals((await call(w, { itineraryId: I })).status, 403);
    noSideEffects(w);

    w = world();
    w.caller.rpcResults['can_travel'] = false;
    assertEquals((await call(w, { itineraryId: I })).status, 403);
    noSideEffects(w);

    w = world();
    w.caller.rpcResults['is_own_or_full'] = false;
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.code], [403, 'FORBIDDEN']);
    noSideEffects(w);
  }));

Deno.test('send-itinerary: el permiso se pregunta por (itinerary, compartir) y la propiedad con el advisor del registro', () =>
  withEnv(async () => {
    const w = world();
    await call(w, { itineraryId: I });
    assertEquals(w.caller.rpcArgs.find((c) => c.name === 'can_travel')?.args, { p_kind: 'itinerary', p_action: 'compartir' });
    assertEquals(w.caller.rpcArgs.find((c) => c.name === 'is_own_or_full')?.args, { p_owner: 'adv-1' });
  }));

Deno.test('send-itinerary: sin correo válido del cliente → 400 NO_RECIPIENT, y un destinatario del cuerpo se ignora', () =>
  withEnv(async () => {
    for (const email of [null, '', '   ', 'no-es-correo']) {
      const w = world();
      w.service.tables.proposals[0].client_email = email;
      const res = await call(w, { itineraryId: I, to: 'otro@example.com', email: 'otro@example.com' });
      assertEquals([res.status, res.body.code], [400, 'NO_RECIPIENT'], String(email));
      noSideEffects(w);
    }
    const w = world();
    await call(w, { itineraryId: I, to: 'otro@example.com' });
    assertEquals(w.resend[0].body.to, ['ana@example.com']);
  }));

Deno.test('send-itinerary: un acceso vencido no se envía (400 EXPIRED)', () =>
  withEnv(async () => {
    const w = world();
    w.service.tables.proposals[0].expires_at = '2027-01-10T11:59:59Z';
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.code], [400, 'EXPIRED']);
    noSideEffects(w);
    const ok = world();
    ok.service.tables.proposals[0].expires_at = '2027-02-01T00:00:00Z';
    assertEquals((await call(ok, { itineraryId: I })).status, 200);
  }));

Deno.test('send-itinerary: entrada inválida → 400; método y CORS', () =>
  withEnv(async () => {
    const w = world();
    assertEquals((await call(w, {})).status, 400);
    assertEquals((await call(w, { itineraryId: 5 })).status, 400);
    assertEquals((await call(w, { proposalId: P })).status, 400); // no acepta el contrato de send-proposal
    noSideEffects(w);
    assertEquals((await handleRequest(new Request('https://x.test/', { method: 'GET' }), w.deps)).status, 405);
    const opt = await handleRequest(new Request('https://x.test/', { method: 'OPTIONS', headers: { Origin: 'https://thetravel-edit.com' } }), w.deps);
    assertEquals([opt.status, opt.headers.get('Access-Control-Allow-Origin')], [204, 'https://thetravel-edit.com']);
  }));

Deno.test('send-itinerary: sin RESEND_API_KEY → 502 y no se escribe nada', () =>
  withEnv(async () => {
    Deno.env.delete('RESEND_API_KEY');
    const w = world();
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.code], [502, 'EMAIL_NOT_CONFIGURED']);
    noSideEffects(w);
  }));

Deno.test('send-itinerary: si Resend rechaza el envío → 502 y NO se audita como enviado', () =>
  withEnv(async () => {
    const w = world();
    w.setResendStatus(500);
    const res = await call(w, { itineraryId: I });
    assertEquals([res.status, res.body.code], [502, 'EMAIL_SEND_FAILED']);
    assertEquals(w.resend.length, 1);
    assertEquals([w.service.writes, w.caller.writes], [[], []]);
  }));

Deno.test('send-itinerary: no modifica solicitudes ni propuestas — la única escritura es la auditoría', () =>
  withEnv(async () => {
    const w = world();
    await call(w, { itineraryId: I });
    assertEquals(w.service.writes, ['insert audit_log']);
    assert(w.service.inserted.every((i) => i.table === 'audit_log'));
  }));
