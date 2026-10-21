import { assertEquals } from 'jsr:@std/assert@1';
import { FakeSupabase } from '../_shared/fake-supabase.ts';
import { loadProposalForActivity } from './proposal-access.ts';

const NOW = Date.parse('2027-01-10T12:00:00Z');
const P = '11111111-1111-4111-8111-111111111111';
const I = '22222222-2222-4222-8222-222222222222';
const S_P = 'sess-p';
const S_I = 'sess-i';

function world() {
  const db = new FakeSupabase();
  const row = (id: string, kind: string, token: string) => ({
    id, kind, public_token: token, status: kind === 'proposal' ? 'accepted' : 'shared', client_name: 'Ana', title: 'Viaje', content: { days: [] },
    advisor_id: 'adv', service_comments: { a: 'hola' }, accepted_by_name: 'Ana', feedback_sent_at: null, accepted_notified_at: null
  });
  db.tables.proposals = [row(P, 'proposal', 'tok-p'), row(I, 'itinerary', 'tok-i')];
  db.tables.proposal_access_sessions = [
    { id: S_P, proposal_id: P, expires_at: '2027-01-10T14:00:00Z' },
    { id: S_I, proposal_id: I, expires_at: '2027-01-10T14:00:00Z' },
    { id: 'old', proposal_id: P, expires_at: '2027-01-10T11:00:00Z' }
  ];
  return db;
}

const load = (db: FakeSupabase, token: string, session: string) => loadProposalForActivity(db as never, token, session, () => NOW);

Deno.test('notify: una propuesta con sesión y token válidos se carga (comportamiento actual intacto)', async () => {
  const res = await load(world(), 'tok-p', S_P);
  assertEquals('proposal' in res && res.proposal.id, P);
});

Deno.test('notify: un itinerario se RECHAZA explícitamente (409 kind_not_supported) para feedback y accepted, sin escribir ni resolver destinatarios', async () => {
  const db = world();
  const res = await load(db, 'tok-i', S_I);
  assertEquals('proposal' in res, false);
  assertEquals([(res as { status: number }).status, (res as { body: { code: string } }).body.code], [409, 'kind_not_supported']);
  // El módulo corta aquí: ni escrituras, ni Auth admin (correo de la asesora), ni rpc.
  assertEquals([db.writes, db.authAdminCalls, db.rpcCalls], [[], [], []]);
});

Deno.test('notify: un itinerario shared/viewed/draft se rechaza igual (el estado no lo habilita)', async () => {
  for (const status of ['draft', 'shared', 'viewed', 'accepted']) {
    const db = world();
    db.tables.proposals[1].status = status;
    assertEquals((await load(db, 'tok-i', S_I) as { status: number }).status, 409, status);
  }
});

Deno.test('notify: sesión vencida o inexistente → 401; token que no es del registro → 404 (no se revela el tipo)', async () => {
  const db = world();
  assertEquals((await load(db, 'tok-p', 'old') as { status: number }).status, 401);
  assertEquals((await load(db, 'tok-p', 'nope') as { status: number }).status, 401);
  assertEquals((await load(db, 'tok-p', S_I) as { status: number }).status, 404); // sesión de un itinerario con el token de una propuesta
  assertEquals((await load(db, 'tok-i', S_P) as { status: number }).status, 404);
  assertEquals((await load(db, 'otro', S_I) as { status: number }).status, 404);
});
