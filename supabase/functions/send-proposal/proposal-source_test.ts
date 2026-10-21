import { assertEquals } from 'jsr:@std/assert@1';
import { FakeSupabase } from '../_shared/fake-supabase.ts';
import { loadProposalToSend } from './proposal-source.ts';

const P = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

const base = { public_token: 'tok', lead_id: null, client_name: 'Ana', client_email: 'ana@example.com', access_required: false, advisor_id: 'adv' };

function world() {
  const row = (id: string, kind: string, status: string) => ({ id, kind, status, ...base });
  const service = new FakeSupabase();
  service.tables.proposals = [row(P, 'proposal', 'published'), row(I, 'itinerary', 'shared'), row(OTHER, 'proposal', 'draft')];
  // El cliente del usuario (RLS): ve P e I, no OTHER.
  const caller = new FakeSupabase();
  caller.tables.proposals = [{ id: P, kind: 'proposal' }, { id: I, kind: 'itinerary' }];
  return { service, caller };
}

const load = (w: ReturnType<typeof world>, id: string) => loadProposalToSend(w.caller as never, w.service as never, id);

Deno.test('send-proposal: una propuesta published se carga para enviar', async () => {
  const w = world();
  const res = await load(w, P);
  assertEquals('proposal' in res && res.proposal.id, P);
});

Deno.test('send-proposal: published y viewed se pueden enviar; draft/accepted/expired no (INVALID_STATUS)', async () => {
  for (const [status, ok] of [['published', true], ['viewed', true], ['draft', false], ['accepted', false], ['expired', false]] as const) {
    const w = world();
    w.service.tables.proposals[0].status = status;
    const res = await load(w, P);
    assertEquals('proposal' in res, ok, status);
    if (!ok) {
      assertEquals((res as { body: { code: string } }).body.code, 'INVALID_STATUS');
    }
  }
});

Deno.test('send-proposal: un itinerario se RECHAZA explícitamente (409 KIND_NOT_SUPPORTED), aunque esté shared', async () => {
  for (const status of ['draft', 'shared', 'viewed']) {
    const w = world();
    w.service.tables.proposals[1].status = status;
    const res = await load(w, I);
    assertEquals('proposal' in res, false, status);
    assertEquals([(res as { status: number }).status, (res as { body: { code: string } }).body.code], [409, 'KIND_NOT_SUPPORTED'], status);
  }
});

Deno.test('send-proposal: el rechazo del itinerario no lee con service_role, no muta datos y no toca auditoría ni leads', async () => {
  const w = world();
  const reads: string[] = [];
  const from = w.service.from.bind(w.service);
  w.service.from = ((t: string) => (reads.push(t), from(t))) as never;
  await load(w, I);
  assertEquals(reads, [], 'cortó con la lectura RLS del usuario, antes de service_role');
  assertEquals([...w.service.writes, ...w.caller.writes], []);
});

Deno.test('send-proposal: defensa en profundidad — si RLS dejara pasar un itinerario con kind ya cambiado, la lectura de service_role lo corta', async () => {
  const w = world();
  w.caller.tables.proposals[1].kind = 'proposal'; // lectura RLS desactualizada/manipulada
  const res = await load(w, I); // service_role sigue viendo 'itinerary'
  assertEquals((res as { body: { code: string } }).body.code, 'KIND_NOT_SUPPORTED');
});

Deno.test('send-proposal: sin acceso (RLS) → 403; inexistente para service_role → 404; kind ausente (columna sin migrar) se trata como no soportado', async () => {
  const w = world();
  assertEquals((await load(w, OTHER) as { status: number }).status, 403);
  w.caller.tables.proposals.push({ id: 'ghost' });
  assertEquals((await load(w, 'ghost') as { body: { code: string } }).body.code, 'KIND_NOT_SUPPORTED');
  w.caller.tables.proposals.push({ id: 'ghost2', kind: 'proposal' });
  assertEquals((await load(w, 'ghost2') as { status: number }).status, 404);
});
