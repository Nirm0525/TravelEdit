// Un itinerario compartido NO congela una versión: el MISMO enlace y la MISMA sesión del cliente ven siempre lo guardado ahora
// (contenido y documentos). Se prueba contra Postgres en memoria (PGlite, migraciones reales 0055 + 0056) y con el handler REAL de
// proposal-documents conectado a esa misma base. Editar no cambia el estado, el enlace ni el acceso.
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { ADVISOR_A, I_ONE, SVC, TOKEN_I, asUser, migrated as migratedTo0055, one } from './travel-kinds-fixture.ts';
import { handleRequest, type Deps } from '../proposal-documents/handler.ts';
import type { PGlite } from 'npm:@electric-sql/pglite@0.3';

const read = (name: string) => Deno.readTextFileSync(new URL(`../../migrations/${name}`, import.meta.url));
const SVC_2 = 'svc-2';

async function sharedItinerary(): Promise<{ db: PGlite; session: string }> {
  const db = await migratedTo0055();
  await db.exec(read('0056_itinerary_sharing.sql'));
  await db.exec(`update public.proposals set destination_text = 'Chile', client_email = 'ana@example.com' where id = '${I_ONE}'`);
  const code = await asUser(db, ADVISOR_A, async () => (await one<{ c: string }>(db, `select public.generate_proposal_access_code('${I_ONE}') c`)).c);
  await asUser(db, ADVISOR_A, () => db.exec(`select public.share_itinerary('${I_ONE}')`));
  await db.exec('set role anon');
  const verified = await one<{ result: string; session_token: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`);
  await db.exec('reset role');
  assertEquals(verified.result, 'ok');
  return { db, session: verified.session_token };
}

/** Lo que entrega el RPC del cliente con una sesión ya emitida (la misma en cada llamada). */
async function clientContent(db: PGlite, session: string) {
  await db.exec('set role anon');
  try {
    return await one<{ content: { cover: { title: string }; days: { id: string; services: { id: string }[] }[] }; status: string }>(
      db, `select * from public.get_proposal_content('${TOKEN_I}', '${session}')`);
  } finally {
    await db.exec('reset role');
  }
}

/** El handler REAL de proposal-documents sobre la base de la prueba (consultas equivalentes a supabase-deps.ts). */
function documentsDeps(db: PGlite): Deps {
  const cols = 'id, service_id, file_name, mime_type, storage_path';
  return {
    env: () => undefined,
    getSession: async (id) => (await db.query<{ proposal_id: string; expires_at: string }>(`select proposal_id, expires_at::text expires_at from public.proposal_access_sessions where id = $1`, [id])).rows[0] ?? null,
    getProposal: async (id) => (await db.query<any>(`select id, kind, public_token, status, expires_at::text expires_at, content from public.proposals where id = $1`, [id])).rows[0] ?? null,
    listVisible: async (pid) => (await db.query<any>(`select ${cols} from public.proposal_service_attachments where proposal_id = $1 and visible_to_client = true order by created_at, id`, [pid])).rows,
    getVisible: async (pid, id) => (await db.query<any>(`select ${cols} from public.proposal_service_attachments where id = $1 and proposal_id = $2 and visible_to_client = true`, [id, pid])).rows[0] ?? null,
    createSignedUrl: (path) => Promise.resolve(`https://storage.test/sign/${path}`),
    log: () => {}
  };
}

async function listDocuments(db: PGlite, session: string) {
  const res = await handleRequest(
    new Request('https://x.test/functions/v1/proposal-documents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list', token: TOKEN_I, sessionToken: session })
    }),
    documentsDeps(db)
  );
  assertEquals(res.status, 200);
  return { cache: res.headers.get('Cache-Control'), names: ((await res.json()).documents as { name: string }[]).map((d) => d.name) };
}

const addDocument = (db: PGlite, name: string, visible: boolean, service = SVC) =>
  db.exec(`insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size, visible_to_client)
    values ('${I_ONE}', '${service}', '${name}', '${I_ONE}/${service}/${name}', 'application/pdf', 100, ${visible})`);

const lifecycle = (db: PGlite) =>
  one<Record<string, unknown>>(db, `select status, shared_at::text, viewed_at::text, public_token, access_required, expires_at::text from public.proposals where id = '${I_ONE}'`);
const sessions = async (db: PGlite) => (await one<{ n: number }>(db, `select count(*)::int n from public.proposal_access_sessions where proposal_id = '${I_ONE}'`)).n;

Deno.test('itinerario compartido: el admin edita el contenido y la MISMA sesión del cliente recibe el contenido nuevo', async () => {
  const { db, session } = await sharedItinerary();
  const first = await clientContent(db, session); // primera lectura: shared → viewed
  assertEquals([first.status, first.content.cover.title, first.content.days.length], ['viewed', 'Portada', 1]);
  const before = await lifecycle(db);

  // Edición como la hace el panel: UPDATE de `content` con el cliente del usuario (portada, un día nuevo, un servicio nuevo).
  const edited = {
    cover: { title: 'Portada nueva', subtitle: '', imagePath: null },
    welcome: { body: 'Hola' },
    days: [{ id: 'd1', services: [{ id: SVC }, { id: SVC_2 }] }, { id: 'd2', services: [] }],
    pricing: { lines: [], feesLines: [] },
    terms: { title: 'Términos', body: 'Texto' }
  };
  await asUser(db, ADVISOR_A, () => db.query(`update public.proposals set content = $1::jsonb where id = '${I_ONE}'`, [JSON.stringify(edited)]));

  const second = await clientContent(db, session); // misma sesión, mismo token
  assertEquals(second.content.cover.title, 'Portada nueva');
  assertEquals(second.content.days.map((d) => d.id), ['d1', 'd2']);
  assertEquals(second.content.days[0].services.map((s) => s.id), [SVC, SVC_2]);
  assertFalse('pricing' in second.content || 'terms' in second.content, 'lo contractual se sigue saneando en el servidor');

  // Editar no cambia estado, fechas, enlace ni acceso, y no revoca la sesión del cliente.
  assertEquals(await lifecycle(db), before);
  assertEquals(await sessions(db), 1);
  assertEquals((await clientContent(db, session)).content.cover.title, 'Portada nueva');
});

Deno.test('itinerario compartido: una asesora puede seguir guardando el contenido en shared y en viewed (sin quedar de solo lectura)', async () => {
  for (const state of ['shared', 'viewed']) {
    const { db, session } = await sharedItinerary();
    if (state === 'viewed') {
      await clientContent(db, session);
    }
    assertEquals((await lifecycle(db)).status, state);
    const updated = await asUser(db, ADVISOR_A, () =>
      db.query(`update public.proposals set content = jsonb_set(content, '{cover,title}', '"Cambiado en ${state}"') where id = '${I_ONE}' returning id`));
    assertEquals(updated.rows.length, 1, `la RLS permite editar en ${state}`);
    assertEquals((await lifecycle(db)).status, state);
  }
});

Deno.test('itinerario compartido: un documento agregado después se lista en la MISMA sesión, y al ocultarlo o borrarlo desaparece', async () => {
  const { db, session } = await sharedItinerary();
  await clientContent(db, session);
  assertEquals((await listDocuments(db, session)).names, []);

  await addDocument(db, 'voucher-hotel.pdf', true);
  assertEquals((await listDocuments(db, session)).names, ['voucher-hotel.pdf']);

  await addDocument(db, 'interno.pdf', false); // no visible: nunca sale
  await addDocument(db, 'entrada.pdf', true);
  assertEquals((await listDocuments(db, session)).names, ['voucher-hotel.pdf', 'entrada.pdf']);

  // Ocultar (visible_to_client = false) → desaparece al volver a listar.
  await db.exec(`update public.proposal_service_attachments set visible_to_client = false where proposal_id = '${I_ONE}' and file_name = 'voucher-hotel.pdf'`);
  assertEquals((await listDocuments(db, session)).names, ['entrada.pdf']);

  // Eliminar la fila → también desaparece.
  await db.exec(`delete from public.proposal_service_attachments where proposal_id = '${I_ONE}' and file_name = 'entrada.pdf'`);
  assertEquals((await listDocuments(db, session)).names, []);

  assertEquals(await sessions(db), 1);
  assertEquals((await lifecycle(db)).status, 'viewed');
});

Deno.test('proposal-documents: la respuesta no se puede guardar en caché (private, no-store)', async () => {
  const { db, session } = await sharedItinerary();
  assertEquals((await listDocuments(db, session)).cache, 'private, no-store');
  const denied = await handleRequest(
    new Request('https://x.test/functions/v1/proposal-documents', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'list', token: TOKEN_I, sessionToken: '00000000-0000-4000-8000-000000000000' })
    }),
    documentsDeps(db)
  );
  assertEquals(denied.status, 404);
  assertEquals(denied.headers.get('Cache-Control'), 'private, no-store');
  assert(true);
});

Deno.test('compartir de nuevo o dejar de compartir sí cambia el acceso; editar no (contraste)', async () => {
  const { db, session } = await sharedItinerary();
  await asUser(db, ADVISOR_A, () => db.exec(`update public.proposals set client_name = 'Otro nombre' where id = '${I_ONE}'`));
  assertEquals(await sessions(db), 1);
  await asUser(db, ADVISOR_A, () => db.exec(`select public.unshare_itinerary('${I_ONE}')`));
  assertEquals(await sessions(db), 0);
  assertEquals((await db.query(`select 1 from public.proposal_access_sessions where id = '${session}'`)).rows.length, 0);
});
