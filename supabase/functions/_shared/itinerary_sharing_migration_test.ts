// Prueba de la migración REAL 0056 (compartir itinerarios), su verify y su rollback, contra Postgres en memoria (PGlite), sobre el
// MISMO punto de partida que 0055 (baseline + 0055 aplicada: travel-kinds-fixture.ts).
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import {
  ADMIN, ADVISOR_A, ADVISOR_B, EDITOR, I_ONE, I_TWO, P_ONE, SVC, TOKEN_I, TOKEN_P,
  asUser, migrated as migratedTo0055, one, read, readScript, rejects
} from './travel-kinds-fixture.ts';
import type { PGlite } from 'npm:@electric-sql/pglite@0.3';

const migration = () => read('0056_itinerary_sharing.sql');
const verify = () => readScript('0056_itinerary_sharing_verify.sql');
const rollback = () => readScript('0056_itinerary_sharing_rollback.sql');
const NOBODY = '99999999-9999-4999-8999-0000000000ff';

async function migrated(): Promise<PGlite> {
  const db = await migratedTo0055();
  await db.exec(migration());
  return db;
}

type Problem = { position: number; code: string; message: string; tab: string };
const readiness = (db: PGlite, uid: string, id: string, forEmail = false) =>
  asUser(db, uid, async () => (await db.query<Problem>(`select * from public.get_itinerary_share_readiness('${id}', ${forEmail})`)).rows);
const codes = (rows: Problem[]) => rows.map((r) => r.code);
const shareAs = (db: PGlite, uid: string, id: string) => asUser(db, uid, () => db.exec(`select public.share_itinerary('${id}')`));
const unshareAs = (db: PGlite, uid: string, id: string) => asUser(db, uid, () => db.exec(`select public.unshare_itinerary('${id}')`));
const row = (db: PGlite, id: string) =>
  one<{ status: string; shared_at: string | null; published_at: string | null; viewed_at: string | null; accepted_at: string | null; public_token: string; content: any }>(
    db, `select status, shared_at, published_at, viewed_at, accepted_at, public_token, content from public.proposals where id = '${id}'`);
const audit = async (db: PGlite, id: string) =>
  (await db.query<{ action: string; entity_type: string; summary: string }>(`select action, entity_type, summary from public.audit_log where entity_id = '${id}' order by action`)).rows;

/** Deja I_ONE listo para compartir: destino, correo y código de acceso (como lo haría la asesora). */
async function makeShareable(db: PGlite, id = I_ONE, owner = ADVISOR_A): Promise<string> {
  await db.exec(`update public.proposals set destination_text = 'Chile', client_email = 'ana@example.com' where id = '${id}'`);
  return await asUser(db, owner, async () => (await one<{ generate_proposal_access_code: string }>(db, `select public.generate_proposal_access_code('${id}')`)).generate_proposal_access_code);
}

// ---------------------------------------------------------------- aplica / verify

Deno.test('0056: se aplica sobre 0055 y el verify da ok en todas las filas', async () => {
  const db = await migrated();
  const { rows } = await db.query<{ n: number; check: string; ok: boolean }>(verify());
  assert(rows.length >= 12);
  assertEquals(rows.filter((r) => !r.ok).map((r) => `${r.n} ${r.check}`), []);
});

Deno.test('0056: sin 0055 (sin kind / shared_at / can_travel) se detiene con un mensaje claro', async () => {
  const { baseline } = await import('./travel-kinds-fixture.ts');
  const db = await baseline();
  await rejects(() => db.exec(migration()), '0056 requiere 0055');
});

Deno.test('0056: se puede volver a aplicar tras el rollback', async () => {
  const db = await migrated();
  await db.exec(rollback());
  await db.exec(migration());
  assertEquals((await db.query<{ ok: boolean }>(verify())).rows.every((r) => r.ok), true);
});

// ---------------------------------------------------------------- share
Deno.test('0056: share_itinerary pasa draft → shared, fija shared_at y NO toca published_at ni nada de aceptación', async () => {
  const db = await migrated();
  await makeShareable(db);
  const before = await row(db, I_ONE);
  assertEquals([before.status, before.shared_at], ['draft', null]);
  await shareAs(db, ADVISOR_A, I_ONE);
  const after = await row(db, I_ONE);
  assertEquals(after.status, 'shared');
  assert(after.shared_at !== null);
  assertEquals([after.published_at, after.viewed_at, after.accepted_at], [null, null, null]);
  assertEquals(after.public_token, before.public_token); // se conserva el token (y el enlace)
  assertEquals(after.content, before.content); // contenido intacto
});

Deno.test('0056: share_itinerary es idempotente: compartir algo ya compartido o visto no cambia nada', async () => {
  const db = await migrated();
  await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  const first = await row(db, I_ONE);
  await shareAs(db, ADVISOR_A, I_ONE);
  assertEquals((await row(db, I_ONE)).shared_at, first.shared_at);
  await db.exec(`update public.proposals set status = 'viewed', viewed_at = now() where id = '${I_ONE}'`);
  await shareAs(db, ADVISOR_A, I_ONE);
  assertEquals((await row(db, I_ONE)).status, 'viewed');
});

Deno.test('0056: share_itinerary revisa los pendientes EN EL SERVIDOR y los dice en el error; no cambia nada', async () => {
  const db = await migrated();
  await rejects(() => shareAs(db, ADVISOR_A, I_ONE), 'Faltan datos para compartir');
  await db.exec('rollback').catch(() => {});
  const r = await row(db, I_ONE);
  assertEquals([r.status, r.shared_at], ['draft', null]);
});

Deno.test('0056: una propuesta NO puede usar share_itinerary, unshare_itinerary ni la lista (kind_not_supported)', async () => {
  const db = await migrated();
  await rejects(() => shareAs(db, ADVISOR_A, P_ONE), 'kind_not_supported');
  await rejects(() => unshareAs(db, ADVISOR_A, P_ONE), 'kind_not_supported');
  await rejects(() => readiness(db, ADVISOR_A, P_ONE), 'kind_not_supported');
  const p = await row(db, P_ONE);
  assertEquals([p.status, p.shared_at], ['published', null]);
});

Deno.test('0056: un id inexistente → «no encontrado»; sin sesión o sin rol → no autorizado', async () => {
  const db = await migrated();
  await makeShareable(db);
  await rejects(() => shareAs(db, ADMIN, '99999999-0000-4000-8000-000000000000'), 'Itinerario no encontrado');
  await rejects(() => shareAs(db, NOBODY, I_ONE), 'No autorizado');
  await rejects(() => unshareAs(db, NOBODY, I_ONE), 'No autorizado');
  await rejects(() => readiness(db, NOBODY, I_ONE), 'No autorizado');
  assertEquals((await row(db, I_ONE)).status, 'draft');
});

// ---------------------------------------------------------------- readiness
Deno.test('0056: la lista de pendientes del itinerario — destino y código de acceso faltan en un borrador nuevo', async () => {
  const db = await migrated();
  const problems = await readiness(db, ADVISOR_A, I_ONE);
  assertEquals(codes(problems), ['destination_missing', 'access_code_missing']);
  assertEquals(problems.map((p) => p.position), [1, 2]);
  assertEquals(problems.map((p) => p.tab), ['client-trip', 'client-trip']);
  for (const p of problems) {
    assert(p.message.length > 0);
  }
});

Deno.test('0056: pendientes — cliente, destino, portada, días, servicios, fechas, acceso y expiración', async () => {
  const db = await migrated();
  await makeShareable(db);
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE)), []);
  const set = async (sql: string) => {
    await db.exec(`update public.proposals set destination_text = 'Chile', client_name = 'Ana', start_date = null, end_date = null, expires_at = null,
      content = '{"cover":{"title":"Portada"},"days":[{"id":"d1","services":[{"id":"s1"}]}]}'::jsonb where id = '${I_ONE}'; ${sql}`);
    return codes(await readiness(db, ADVISOR_A, I_ONE));
  };
  assertEquals(await set(`update public.proposals set content = '{"cover":{"title":""},"days":[{"id":"d1","services":[{"id":"s1"}]}]}'::jsonb where id = '${I_ONE}'`), ['cover_title_missing']);
  assertEquals(await set(`update public.proposals set content = '{"cover":{"title":"Portada"},"days":[]}'::jsonb where id = '${I_ONE}'`), ['days_missing']);
  assertEquals(await set(`update public.proposals set content = '{"cover":{"title":"Portada"}}'::jsonb where id = '${I_ONE}'`), ['days_missing']);
  assertEquals(await set(`update public.proposals set content = '{"cover":{"title":"Portada"},"days":[{"id":"d1","services":[]}]}'::jsonb where id = '${I_ONE}'`), ['services_missing']);
  assertEquals(await set(`update public.proposals set destination_text = '  ' where id = '${I_ONE}'`), ['destination_missing']);
  assertEquals(await set(`update public.proposals set start_date = '2030-02-01', end_date = '2030-01-01' where id = '${I_ONE}'`), ['dates_inverted']);
  assertEquals(await set(`update public.proposals set expires_at = now() - interval '1 day' where id = '${I_ONE}'`), ['expiry_in_past']);
  assertEquals(await set(`update public.proposals set expires_at = now() + interval '1 day' where id = '${I_ONE}'`), []);
  // Sin acceso privado no hace falta código.
  assertEquals(await set(`update public.proposals set access_required = false where id = '${I_ONE}'`), []);
});

Deno.test('0056: el correo del cliente solo se exige para el envío por correo (para_correo = true)', async () => {
  const db = await migrated();
  await makeShareable(db);
  await db.exec(`update public.proposals set client_email = null where id = '${I_ONE}'`);
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE, false)), []);
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE, true)), ['client_email_missing']);
  await db.exec(`update public.proposals set client_email = 'no-es-correo' where id = '${I_ONE}'`).catch(() => undefined);
  // El CHECK de la tabla ya impide un correo inválido: queda la regla del servidor para filas anteriores a él.
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE, true)).length >= 1, true);
  // Y compartir NO exige correo: se puede copiar el enlace o usar WhatsApp.
  await shareAs(db, ADVISOR_A, I_ONE);
  assertEquals((await row(db, I_ONE)).status, 'shared');
});

Deno.test('0056: la lista de pendientes NO consulta precios, términos, aceptación, elecciones ni comentarios — y no cambia con ellos', async () => {
  const db = await migrated();
  await makeShareable(db);
  const clean = codes(await readiness(db, ADVISOR_A, I_ONE));
  await db.exec(`update public.proposals set content = jsonb_set(jsonb_set(content, '{pricing}', '{"lines":[{"id":"x","label":"Basura","quantity":9,"unitPrice":9}],"feesLines":[]}'::jsonb),
                  '{terms}', '{"title":"","body":""}'::jsonb) where id = '${I_ONE}'`);
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE)), clean);
  for (const name of ['itinerary_share_problems', 'get_itinerary_share_readiness', 'share_itinerary', 'unshare_itinerary']) {
    const def = (await one<{ def: string }>(db, `select lower(pg_get_functiondef(p.oid)) def from pg_proc p where p.proname = '${name}'`)).def;
    for (const banned of ['pricing', 'terms', 'accepted', 'service_choices', 'service_comments', 'published_at']) {
      assert(!def.includes(banned), `${name} menciona ${banned}`);
    }
  }
});

Deno.test('0056: un itinerario ya compartido devuelve invalid_status', async () => {
  const db = await migrated();
  await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  assertEquals(codes(await readiness(db, ADVISOR_A, I_ONE)), ['invalid_status']);
});

// ---------------------------------------------------------------- unshare
Deno.test('0056: unshare_itinerary: shared y viewed → draft, shared_at nulo, contenido y documentos intactos', async () => {
  for (const state of ['shared', 'viewed']) {
    const db = await migrated();
    await makeShareable(db);
    await shareAs(db, ADVISOR_A, I_ONE);
    if (state === 'viewed') {
      await db.exec(`update public.proposals set status = 'viewed', viewed_at = now() where id = '${I_ONE}'`);
    }
    await db.exec('set role service_role');
    await db.exec(`insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size)
      values ('${I_ONE}', '${SVC}', 'itin-A.pdf', '${I_ONE}/${SVC}/itin-A.pdf', 'application/pdf', 100)`);
    await db.exec('reset role');
    const before = await row(db, I_ONE);
    await unshareAs(db, ADVISOR_A, I_ONE);
    const after = await row(db, I_ONE);
    assertEquals([after.status, after.shared_at, after.viewed_at, after.published_at, after.accepted_at], ['draft', null, null, null, null], state);
    assertEquals(after.content, before.content);
    assertEquals(after.public_token, before.public_token);
    assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposal_service_attachments where proposal_id = '${I_ONE}'`)).n, 1);
  }
});

Deno.test('0056: unshare es idempotente sobre un borrador y no lo rompe', async () => {
  const db = await migrated();
  await unshareAs(db, ADVISOR_A, I_ONE);
  assertEquals((await row(db, I_ONE)).status, 'draft');
});

Deno.test('0056: unshare REVOCA todas las sesiones y el enlace deja de entregar contenido hasta volver a compartir', async () => {
  const db = await migrated();
  const code = await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);

  const open = async () => {
    await db.exec('set role anon');
    try {
      const gate = (await db.query(`select * from public.get_proposal_gate('${TOKEN_I}')`)).rows.length;
      const verified = await one<{ result: string; session_token: string | null }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`);
      return { gate, verified };
    } finally {
      await db.exec('reset role');
    }
  };
  const content = async (session: string) => {
    await db.exec('set role anon');
    try {
      return await db.query(`select * from public.get_proposal_content('${TOKEN_I}', '${session}')`);
    } finally {
      await db.exec('reset role');
    }
  };

  const opened = await open();
  assertEquals([opened.gate, opened.verified.result], [1, 'ok']);
  const session = opened.verified.session_token!;
  assertEquals((await content(session)).rows.length, 1);
  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposal_access_sessions where proposal_id = '${I_ONE}'`)).n, 1);

  await unshareAs(db, ADVISOR_A, I_ONE);

  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposal_access_sessions where proposal_id = '${I_ONE}'`)).n, 0);
  await rejects(() => content(session), 'session_invalid'); // la sesión que ya tenía el cliente murió
  const closed = await open();
  assertEquals([closed.gate, closed.verified.result, closed.verified.session_token], [0, 'not_found', null]);

  // Al volver a compartir, el MISMO enlace vuelve a abrir (con sesión nueva).
  await shareAs(db, ADVISOR_A, I_ONE);
  const again = await open();
  assertEquals([again.gate, again.verified.result], [1, 'ok']);
  await rejects(() => content(session), 'session_invalid'); // la sesión vieja sigue muerta
});

Deno.test('0056: un itinerario en borrador no entrega nada: ni gate, ni acceso, ni contenido', async () => {
  const db = await migrated();
  const code = await makeShareable(db);
  await db.exec('set role anon');
  assertEquals((await db.query(`select * from public.get_proposal_gate('${TOKEN_I}')`)).rows.length, 0);
  assertEquals((await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`)).result, 'not_found');
  await db.exec('reset role');
});

// ---------------------------------------------------------------- acceso del cliente, vigencia y saneado
Deno.test('0056: acceso con código, vigencia y contenido saneado en el servidor aunque la fila esté contaminada', async () => {
  const db = await migrated();
  const code = await makeShareable(db);
  await db.exec(`update public.proposals set content = content || '{"pricing":{"lines":[{"id":"x","label":"SECRETO","quantity":1,"unitPrice":99}],"feesLines":[]},"terms":{"title":"T","body":"TÉRMINOS SECRETOS"}}'::jsonb where id = '${I_ONE}'`);
  await shareAs(db, ADVISOR_A, I_ONE);

  await db.exec('set role anon');
  assertEquals((await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', 'TRV-MALO')`)).result, 'invalid_code');
  const ok = await one<{ result: string; session_token: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`);
  assertEquals(ok.result, 'ok');
  const c = await one<{ content: Record<string, unknown>; status: string; pricing_total: string; terms_accepted: boolean; service_choices: unknown; service_comments: unknown; kind: string }>(
    db, `select * from public.get_proposal_content('${TOKEN_I}', '${ok.session_token}')`);
  await db.exec('reset role');
  assertEquals([c.kind, c.status], ['itinerary', 'viewed']);
  assertEquals(Object.keys(c.content).sort(), ['cover', 'days', 'welcome']);
  assert(!JSON.stringify(c).includes('SECRETO'));
  assert(!JSON.stringify(c).includes('TÉRMINOS SECRETOS'));
  assertEquals([Number(c.pricing_total), c.terms_accepted, c.service_choices, c.service_comments], [0, false, {}, {}]);

  // Vencido: el enlace abre pero no entrega sesión.
  await db.exec(`update public.proposals set expires_at = now() - interval '1 minute' where id = '${I_ONE}'`);
  await db.exec('set role anon');
  assertEquals((await one<{ status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_I}')`)).status, 'expired');
  assertEquals((await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`)).result, 'expired');
  await db.exec('reset role');
});

Deno.test('0056: sin acceso privado (access_required = false) el enlace compartido abre sin código', async () => {
  const db = await migrated();
  await makeShareable(db);
  await db.exec(`update public.proposals set access_required = false where id = '${I_ONE}'`);
  await shareAs(db, ADVISOR_A, I_ONE);
  await db.exec('set role anon');
  assertEquals((await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', null)`)).result, 'ok');
  await db.exec('reset role');
});

// ---------------------------------------------------------------- permisos
Deno.test('0056: permisos — admin y editor comparten cualquiera; la asesora solo los suyos; sin rol, nadie', async () => {
  const db = await migrated();
  const codeB = await makeShareable(db, I_TWO, ADVISOR_B);
  assert(codeB.length > 0);
  // Otra asesora no ve ni comparte, ni lee la lista, ni deja de compartir el de B.
  await rejects(() => shareAs(db, ADVISOR_A, I_TWO), 'pertenece a otra asesora');
  await rejects(() => readiness(db, ADVISOR_A, I_TWO), 'pertenece a otra asesora');
  await rejects(() => unshareAs(db, ADVISOR_A, I_TWO), 'pertenece a otra asesora');
  assertEquals((await row(db, I_TWO)).status, 'draft');
  await shareAs(db, EDITOR, I_TWO);
  assertEquals((await row(db, I_TWO)).status, 'shared');
  await unshareAs(db, ADMIN, I_TWO);
  assertEquals((await row(db, I_TWO)).status, 'draft');
  await shareAs(db, ADVISOR_B, I_TWO);
  assertEquals((await row(db, I_TWO)).status, 'shared');
  await rejects(() => unshareAs(db, ADVISOR_A, I_TWO), 'pertenece a otra asesora');
});

Deno.test('0056: can_travel — compartir solo para itinerario (admin, editor, staff); propuesta y tipos o acciones desconocidas, no', async () => {
  const db = await migrated();
  const can = (uid: string, kind: string, action: string) => asUser(db, uid, async () => (await one<{ c: boolean }>(db, `select public.can_travel('${kind}', '${action}') c`)).c);
  for (const uid of [ADMIN, EDITOR, ADVISOR_A]) {
    assertEquals(await can(uid, 'itinerary', 'compartir'), true, uid);
    assertEquals(await can(uid, 'proposal', 'compartir'), false, uid);
  }
  assertEquals(await can(NOBODY, 'itinerary', 'compartir'), false);
  assertEquals(await can(ADMIN, 'trip', 'compartir'), false);
  assertEquals(await can(ADMIN, 'itinerary', 'descompartir'), false);
  // Lo de 0055 no cambió.
  assertEquals(await can(ADMIN, 'itinerary', 'eliminar'), true);
  assertEquals(await can(EDITOR, 'itinerary', 'eliminar'), false);
  assertEquals(await can(ADMIN, 'itinerary', 'publicar'), false);
  assertEquals(await can(ADVISOR_A, 'proposal', 'publicar'), true);
  assertEquals(await can(ADVISOR_A, 'itinerary', 'gestionar_documentos'), true);
});

Deno.test('0056: eliminar sigue siendo solo del admin y las RPC no son ejecutables por anon', async () => {
  const db = await migrated();
  await db.exec('set role anon');
  for (const sql of [`select public.share_itinerary('${I_ONE}')`, `select public.unshare_itinerary('${I_ONE}')`, `select * from public.get_itinerary_share_readiness('${I_ONE}', false)`]) {
    await assertRejects(() => db.exec(sql), Error, 'permission denied');
  }
  await db.exec('reset role');
  await asUser(db, ADVISOR_A, async () => {
    await assertRejects(() => db.exec(`select * from private.itinerary_share_problems('${I_ONE}', false)`), Error, 'permission denied');
    assertEquals((await db.query(`delete from public.proposals where id = '${I_ONE}' returning id`)).rows.length, 0);
  });
  await asUser(db, EDITOR, async () => {
    assertEquals((await db.query(`delete from public.proposals where id = '${I_ONE}' returning id`)).rows.length, 0);
  });
  await asUser(db, ADMIN, async () => {
    assertEquals((await db.query(`delete from public.proposals where id = '${I_ONE}' returning id`)).rows.length, 1);
  });
});

Deno.test('0056: authenticated sigue SIN poder escribir status ni shared_at: solo se comparte por la RPC', async () => {
  const db = await migrated();
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`update public.proposals set status = 'shared', shared_at = now() where id = '${I_ONE}'`), 'permission denied');
    await rejects(() => db.exec(`update public.proposals set shared_at = now() where id = '${I_ONE}'`), 'permission denied');
  });
  assertEquals((await row(db, I_ONE)).status, 'draft');
});

// ---------------------------------------------------------------- auditoría
Deno.test('0056: auditoría — itinerary_shared / itinerary_unshared (una fila por transición) y nada de proposal_*', async () => {
  const db = await migrated();
  await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  await shareAs(db, ADVISOR_A, I_ONE); // idempotente: no vuelve a auditar
  await unshareAs(db, ADVISOR_A, I_ONE);
  const log = await audit(db, I_ONE);
  const actions = log.map((l) => l.action);
  assertEquals(actions.filter((a) => a === 'itinerary_shared').length, 1);
  assertEquals(actions.filter((a) => a === 'itinerary_unshared').length, 1);
  assert(!actions.some((a) => a.startsWith('proposal_')), actions.join(','));
  assert(log.every((l) => l.entity_type === 'itinerary'));
  assertStringIncludes(log.find((l) => l.action === 'itinerary_shared')!.summary, 'Compartió el itinerario');
  assertStringIncludes(log.find((l) => l.action === 'itinerary_unshared')!.summary, 'Dejó de compartir el itinerario');
});

Deno.test('0056: la primera visualización del cliente se audita como itinerary_status_changed (no como compartido)', async () => {
  const db = await migrated();
  const code = await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  await db.exec('set role anon');
  const ok = await one<{ session_token: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`);
  await db.query(`select * from public.get_proposal_content('${TOKEN_I}', '${ok.session_token}')`);
  await db.exec('reset role');
  const actions = (await audit(db, I_ONE)).map((l) => l.action);
  assertEquals(actions.filter((a) => a === 'itinerary_shared').length, 1);
  assert(actions.includes('itinerary_status_changed'));
});

Deno.test('0056: la auditoría de PROPUESTAS no cambió (publicar y despublicar siguen en proposal_status_changed)', async () => {
  const db = await migrated();
  await db.exec(`update public.proposals set status = 'draft', published_at = null where id = '${P_ONE}'`);
  await asUser(db, ADVISOR_A, async () => {
    await db.exec(`select public.generate_proposal_access_code('${P_ONE}')`);
  });
  await db.exec(`update public.proposals set status = 'published', published_at = now() where id = '${P_ONE}'`);
  const log = await audit(db, P_ONE);
  const changed = log.filter((l) => l.action === 'proposal_status_changed');
  assert(changed.length >= 1);
  assert(changed.every((l) => l.entity_type === 'proposal'));
  assertStringIncludes(changed[changed.length - 1].summary, 'Publicó la propuesta');
  assert(!log.some((l) => l.action.startsWith('itinerary_')));
});

Deno.test('0056: publish_proposal y unpublish_proposal siguen rechazando itinerarios y no se ven afectados por share', async () => {
  const db = await migrated();
  await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`select public.publish_proposal('${I_ONE}')`), 'kind_not_supported');
    await rejects(() => db.exec(`select public.unpublish_proposal('${I_ONE}')`), 'kind_not_supported');
  });
  assertEquals((await row(db, I_ONE)).status, 'shared');
});

// ---------------------------------------------------------------- verify y rollback
Deno.test('0056: el verify DETECTA los problemas', async () => {
  const failing = async (tamper: string) => {
    const db = await migrated();
    await db.exec(tamper);
    return (await db.query<{ n: number; ok: boolean }>(verify())).rows.filter((r) => !r.ok).map((r) => r.n);
  };
  assert((await failing(`grant execute on function public.share_itinerary(uuid) to anon`)).includes(3));
  assert((await failing(`grant execute on function private.itinerary_share_problems(uuid, boolean) to authenticated`)).includes(4));
  assert((await failing(`drop function public.unshare_itinerary(uuid)`)).includes(1));
  assert((await failing(`update public.proposals set shared_at = now() where id = '${I_ONE}'`).catch(() => [99])).length > 0);
  assert((await failing(`update public.proposals set status = 'shared' where id = '${I_ONE}'`).catch(() => [99])).length > 0);
});

Deno.test('0056: el rollback se NIEGA si hay un itinerario compartido o visto, y no cambia nada', async () => {
  for (const state of ['shared', 'viewed']) {
    const db = await migrated();
    await makeShareable(db);
    await shareAs(db, ADVISOR_A, I_ONE);
    if (state === 'viewed') {
      await db.exec(`update public.proposals set status = 'viewed', viewed_at = now() where id = '${I_ONE}'`);
    }
    await rejects(() => db.exec(rollback()), 'Hay itinerarios compartidos o vistos');
    await db.exec('rollback').catch(() => {});
    assertEquals((await db.query(`select 1 from pg_proc where proname = 'share_itinerary'`)).rows.length, 1, state);
  }
});

Deno.test('0056: el rollback (sin itinerarios compartidos) devuelve can_travel y la auditoría a 0055 y borra las RPC', async () => {
  const db = await migrated();
  await makeShareable(db);
  await shareAs(db, ADVISOR_A, I_ONE);
  await unshareAs(db, ADVISOR_A, I_ONE);
  await db.exec(rollback());
  assertEquals((await db.query(`select 1 from pg_proc where proname in ('share_itinerary', 'unshare_itinerary', 'get_itinerary_share_readiness', 'itinerary_share_problems')`)).rows.length, 0);
  const can = await asUser(db, ADMIN, async () => (await one<{ c: boolean }>(db, `select public.can_travel('itinerary', 'compartir') c`)).c);
  assertEquals(can, false);
  const def = (await one<{ def: string }>(db, `select pg_get_functiondef('public.log_proposal_status_change'::regproc) def`)).def;
  assert(!def.includes('itinerary_shared'));
  assertStringIncludes(def, 'itinerary_status_changed');
  // Y una propuesta sigue publicándose y auditándose como siempre.
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'published');
});

Deno.test('0056: la migración no toca publish/unpublish/send ni las RPC de acceso (solo can_travel, log_proposal_status_change y lo nuevo)', () => {
  const sql = migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').toLowerCase();
  for (const forbidden of ['function public.publish_proposal', 'function public.unpublish_proposal', 'function public.accept_proposal',
                           'function public.get_proposal_gate', 'function public.verify_proposal_access', 'function public.get_proposal_content',
                           'alter table', 'drop table', 'create policy', 'drop policy']) {
    assert(!sql.includes(forbidden), forbidden);
  }
  assertStringIncludes(migration(), 'supabase db query --linked -f supabase/migrations/0056_itinerary_sharing.sql');
});

Deno.test('0056: token de la propuesta legacy intacto (sanity) y rutas de acceso de propuestas siguen igual', async () => {
  const db = await migrated();
  await db.exec('set role anon');
  const gate = await one<{ kind: string; status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_P}')`);
  await db.exec('reset role');
  assertEquals([gate.kind, gate.status], ['proposal', 'published']);
});
