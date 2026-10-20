// Prueba de la migración REAL 0054 (más su verify y su rollback) contra Postgres en memoria (PGlite), con un esquema
// reducido de lo que la migración usa (roles, profiles, proposals, can_manage_proposals, set_updated_at, storage.buckets).
import { PGlite } from 'npm:@electric-sql/pglite@0.3';
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';

const read = (name: string) => Deno.readTextFileSync(new URL(`../../migrations/${name}`, import.meta.url));
const readScript = (name: string) => Deno.readTextFileSync(new URL(`../../migration-scripts/${name}`, import.meta.url));

const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';
const SVC_A = 'svc-a';
const SVC_X = 'svc-x';
const USER = '99999999-9999-4999-8999-999999999991';
const ADVISOR_A = '99999999-9999-4999-8999-99999999000a';
const ADVISOR_B = '99999999-9999-4999-8999-99999999000b';
const ADMIN = '99999999-9999-4999-8999-99999999000c';
const EDITOR = '99999999-9999-4999-8999-99999999000d';
const NO_ROLE = '99999999-9999-4999-8999-99999999000e';

async function setup(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;

    create schema storage;
    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;

    create schema private;
    create schema auth;
    grant usage on schema private, auth to authenticated, service_role;
    -- auth.uid() y el rol del usuario salen de los ajustes de la sesión (en producción, del JWT y de profiles).
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;

    create table public.profiles (id uuid primary key, role text);
    create table public.proposals (
      id uuid primary key, content jsonb not null default '{}', updated_at timestamptz default now(), advisor_id uuid);
    alter table public.proposals enable row level security;
    grant select on public.proposals to authenticated;
    grant select on public.profiles to authenticated;
    grant all on public.proposals to service_role;

    -- Réplica de los helpers REALES (0029 y 0047): can_manage_proposals() e is_own_or_full().
    create function private.app_user_role() returns text language sql stable security definer set search_path = '' as
      $$ select p.role from public.profiles p where p.id = auth.uid() $$;
    create function public.can_manage_proposals() returns boolean language sql stable security definer set search_path = '' as
      $$ select private.app_user_role() in ('admin', 'editor', 'staff') $$;
    create function public.is_own_or_full(p_owner uuid) returns boolean language sql stable set search_path = '' as $$
      select case
        when private.app_user_role() = 'staff' then p_owner is not null and p_owner = auth.uid()
        else true
      end
    $$;
    -- Policy REAL de proposals (0047).
    create policy proposals_select on public.proposals for select
      using (public.can_manage_proposals() and public.is_own_or_full(advisor_id));

    create function public.set_updated_at() returns trigger language plpgsql as
      $$ begin new.updated_at = now(); return new; end $$;

    insert into public.profiles values
      ('${USER}', 'admin'), ('${ADVISOR_A}', 'staff'), ('${ADVISOR_B}', 'staff'),
      ('${ADMIN}', 'admin'), ('${EDITOR}', 'editor'), ('${NO_ROLE}', null);
    insert into public.proposals (id, content, advisor_id) values
      ('${P1}', '{"days":[{"id":"d1","services":[{"id":"${SVC_A}"}]}]}', '${ADVISOR_A}'),
      ('${P2}', '{"days":[{"id":"d2","services":[{"id":"${SVC_X}"}]}]}', '${ADVISOR_B}');
  `);
  await db.exec(read('0054_proposal_service_attachments.sql'));
  return db;
}

interface Row {
  id: string;
  visible_to_client: boolean;
}

const insert = (db: PGlite, over: Partial<Record<string, unknown>> = {}) => {
  const v = { proposal_id: P1, service_id: SVC_A, file_name: 'Boleto.pdf', storage_path: `${P1}/${SVC_A}/${crypto.randomUUID()}.pdf`, mime_type: 'application/pdf', file_size: 1000, ...over };
  return db.query<Row>(
    `insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size)
     values ($1, $2, $3, $4, $5, $6) returning *`,
    [v.proposal_id, v.service_id, v.file_name, v.storage_path, v.mime_type, v.file_size]
  );
};

Deno.test('0054: la migración se aplica y su verify da ok en todas las filas', async () => {
  const db = await setup();
  const { rows } = await db.query<{ check: string; ok: boolean }>(readScript('0054_proposal_service_attachments_verify.sql'));
  assert(rows.length >= 15, `solo ${rows.length} comprobaciones`);
  assertEquals(rows.filter((r) => !r.ok).map((r) => r.check), []);
});

Deno.test('0054: visible_to_client nace en false y el servicio debe existir en el contenido de ESA propuesta', async () => {
  const db = await setup();
  const { rows } = await insert(db);
  assertEquals(rows[0].visible_to_client, false);
  // proposal A + service_id de la propuesta B
  await assertRejects(() => insert(db, { service_id: SVC_X }), Error, 'service_not_found');
  await assertRejects(() => insert(db, { proposal_id: P2, service_id: SVC_A }), Error, 'service_not_found');
  await assertRejects(() => insert(db, { service_id: 'no-existe' }), Error, 'service_not_found');
  assertEquals((await insert(db, { proposal_id: P2, service_id: SVC_X })).rows.length, 1);
});

Deno.test('0054: constraints — nombre, MIME, tamaño, ruta única, FK y service_id', async () => {
  const db = await setup();
  await assertRejects(() => insert(db, { file_name: '   ' }), Error, 'psa_file_name_not_blank');
  await assertRejects(() => insert(db, { mime_type: 'application/msword' }), Error, 'psa_mime_type_allowed');
  await assertRejects(() => insert(db, { mime_type: 'image/svg+xml' }), Error, 'psa_mime_type_allowed');
  await assertRejects(() => insert(db, { file_size: -1 }), Error, 'psa_file_size_range');
  await assertRejects(() => insert(db, { file_size: 10485761 }), Error, 'psa_file_size_range');
  assertEquals((await insert(db, { file_size: 0 })).rows.length, 1);
  assertEquals((await insert(db, { file_size: 10485760 })).rows.length, 1);
  const path = `${P1}/${SVC_A}/${crypto.randomUUID()}.pdf`;
  await insert(db, { storage_path: path });
  await assertRejects(() => insert(db, { storage_path: path }), Error, 'psa_storage_path_unique');
  await assertRejects(() => insert(db, { proposal_id: '33333333-3333-4333-8333-333333333333' }), Error);
  await assertRejects(() => insert(db, { service_id: '' }), Error);
});

Deno.test('0054: máximo 10 archivos por servicio', async () => {
  const db = await setup();
  await db.exec('delete from public.proposal_service_attachments');
  for (let i = 0; i < 9; i++) {
    await insert(db); // ya hay 2 de la prueba anterior? no: base nueva en cada test
  }
  assertEquals((await insert(db)).rows.length, 1); // el décimo
  await assertRejects(() => insert(db), Error, 'too_many_files');
  // Otro servicio no cuenta.
  assertEquals((await insert(db, { proposal_id: P2, service_id: SVC_X })).rows.length, 1);
});

Deno.test('0054: updated_at se actualiza al modificar la fila', async () => {
  const db = await setup();
  const { rows } = await insert(db);
  await db.exec(`update public.proposal_service_attachments set updated_at = '2000-01-01'`);
  await db.exec(`update public.proposal_service_attachments set visible_to_client = true`);
  const after = (await db.query<{ updated_at: Date }>(`select updated_at from public.proposal_service_attachments where id = $1`, [rows[0].id])).rows[0];
  assert(new Date(after.updated_at).getFullYear() >= 2024);
});

Deno.test('0054: anon no tiene ningún acceso directo a la tabla', async () => {
  const db = await setup();
  await insert(db);
  await db.exec('set role anon');
  await assertRejects(() => db.query('select * from public.proposal_service_attachments'), Error, 'permission denied');
  await assertRejects(() => db.query('select count(*) from public.proposal_service_attachments'), Error, 'permission denied');
  await assertRejects(() => db.exec(`insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size) values ('${P1}', '${SVC_A}', 'x.pdf', 'p', 'application/pdf', 1)`), Error, 'permission denied');
  await db.exec('reset role');
});

Deno.test('0054: RLS del listado admin — la Asesora solo ve los adjuntos de SUS propuestas; admin y editor ven todos', async () => {
  const db = await setup();
  await insert(db, { file_name: 'de-A.pdf' }); // propuesta P1 → Asesora A
  await insert(db, { proposal_id: P2, service_id: SVC_X, file_name: 'de-B.pdf' }); // propuesta P2 → Asesora B

  const visibleAs = async (uid: string) => {
    await db.exec('set role authenticated');
    await db.exec(`select set_config('app.uid', '${uid}', false)`);
    try {
      return (await db.query<{ file_name: string }>('select file_name from public.proposal_service_attachments order by file_name')).rows.map((r) => r.file_name);
    } finally {
      await db.exec('reset role');
    }
  };

  assertEquals(await visibleAs(ADVISOR_A), ['de-A.pdf']); // ve los de su propuesta y NO los de la B
  assertEquals(await visibleAs(ADVISOR_B), ['de-B.pdf']);
  assertEquals(await visibleAs(ADMIN), ['de-A.pdf', 'de-B.pdf']);
  assertEquals(await visibleAs(EDITOR), ['de-A.pdf', 'de-B.pdf']); // is_own_or_full: editor ve todo, como en proposals
  assertEquals(await visibleAs(NO_ROLE), []); // autenticado sin permiso para gestionar propuestas
  assertEquals(await visibleAs('99999999-9999-4999-8999-0000000000ff'), []); // usuario sin perfil
});

Deno.test('0054: authenticated NO escribe directamente (solo service_role, desde las Edge Functions), aunque sea admin', async () => {
  const db = await setup();
  await insert(db);
  await db.exec('set role authenticated');
  await db.exec(`select set_config('app.uid', '${ADMIN}', false)`);
  for (const stmt of [
    `insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size) values ('${P1}', '${SVC_A}', 'x.pdf', 'p', 'application/pdf', 1)`,
    `update public.proposal_service_attachments set visible_to_client = true`,
    `delete from public.proposal_service_attachments`
  ]) {
    await assertRejects(() => db.exec(stmt), Error, 'permission denied');
  }
  await db.exec('reset role');
});

Deno.test('0054: la función del trigger no es ejecutable por anon ni authenticated, y el trigger sigue funcionando', async () => {
  const db = await setup();
  await db.exec('set role authenticated');
  await assertRejects(() => db.exec('select public.enforce_service_attachment()'), Error, 'permission denied');
  await db.exec('reset role');
  await db.exec('set role anon');
  await assertRejects(() => db.exec('select public.enforce_service_attachment()'), Error, 'permission denied');
  await db.exec('reset role');
  await db.exec('set role service_role');
  assertEquals((await insert(db)).rows.length, 1); // el trigger se dispara igual
  await db.exec('reset role');
});

Deno.test('0054: service_role (las Edge Functions) sí escribe', async () => {
  const db = await setup();
  await db.exec('set role service_role');
  const { rows } = await insert(db);
  await db.exec(`update public.proposal_service_attachments set visible_to_client = true`);
  await db.exec(`delete from public.proposal_service_attachments where id = '${rows[0].id}'`);
  await db.exec('reset role');
});

Deno.test('0054: no hay SECURITY DEFINER ni policies de storage.objects en la migración', () => {
  const sql = read('0054_proposal_service_attachments.sql').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert(!/security\s+definer/i.test(sql));
  assert(!/on\s+storage\.objects/i.test(sql), 'sin policies directas de storage');
  assert(!/public\s*=\s*true|, true,\s*10485760/i.test(sql), 'el bucket no es público');
  assertStringIncludes(sql, "values ('proposal-service-files', 'proposal-service-files', false");
});

Deno.test('0054: el rollback borra la tabla y el bucket, y se niega si el bucket tiene archivos', async () => {
  const db = await setup();
  await db.exec(`insert into storage.objects (bucket_id, name) values ('proposal-service-files', 'a/b/c.pdf')`);
  await assertRejects(() => db.exec(readScript('0054_proposal_service_attachments_rollback.sql')), Error, 'todavía tiene archivos');
  await db.exec('rollback').catch(() => {});
  // La reversión fallida no borró nada.
  assertEquals((await db.query(`select 1 from storage.buckets where id = 'proposal-service-files'`)).rows.length, 1);
  assertEquals((await db.query<{ t: string | null }>(`select to_regclass('public.proposal_service_attachments') as t`)).rows[0].t, 'proposal_service_attachments');

  await db.exec(`delete from storage.objects`);
  await db.exec(readScript('0054_proposal_service_attachments_rollback.sql'));
  assertEquals((await db.query<{ t: string | null }>(`select to_regclass('public.proposal_service_attachments') as t`)).rows[0].t, null);
  assertEquals((await db.query(`select 1 from storage.buckets where id = 'proposal-service-files'`)).rows.length, 0);
});

Deno.test('0054: solo la migración principal está en supabase/migrations; verify y rollback viven en migration-scripts', () => {
  const inMigrations = [...Deno.readDirSync(new URL('../../migrations/', import.meta.url))].map((e) => e.name).filter((n) => n.startsWith('0054_'));
  assertEquals(inMigrations, ['0054_proposal_service_attachments.sql']);
  const inScripts = [...Deno.readDirSync(new URL('../../migration-scripts/', import.meta.url))].map((e) => e.name).filter((n) => n.startsWith('0054_')).sort();
  assertEquals(inScripts, ['0054_proposal_service_attachments_rollback.sql', '0054_proposal_service_attachments_verify.sql']);
});

Deno.test('0054: los comandos de cada SQL apuntan a sus rutas reales', () => {
  const main = read('0054_proposal_service_attachments.sql');
  assertStringIncludes(main, 'supabase db query --linked -f supabase/migrations/0054_proposal_service_attachments.sql');
  assertStringIncludes(main, 'supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_verify.sql');
  assertStringIncludes(main, 'supabase db query --linked -f supabase/migration-scripts/0054_proposal_service_attachments_rollback.sql');
  assertStringIncludes(readScript('0054_proposal_service_attachments_verify.sql'), '-f supabase/migration-scripts/0054_proposal_service_attachments_verify.sql');
  assertStringIncludes(readScript('0054_proposal_service_attachments_rollback.sql'), '-f supabase/migration-scripts/0054_proposal_service_attachments_rollback.sql');
  for (const name of ['0054_proposal_service_attachments_verify.sql', '0054_proposal_service_attachments_rollback.sql']) {
    assert(!readScript(name).includes('supabase/migrations/'), `${name} no debe apuntar a supabase/migrations`);
  }
});
