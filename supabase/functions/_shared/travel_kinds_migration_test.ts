// Prueba de la migración REAL 0055 (más su verify, su rollback y el preflight) contra Postgres en memoria (PGlite).
// El punto de partida replica el estado PREVIO de producción con las definiciones reales del repo (0029, 0030, 0031, 0032,
// 0033, 0035/0038, 0043, 0044, 0047, 0049 reducida, 0051, 0053 y 0054) y luego aplica 0055 tal cual.
import { PGlite } from 'npm:@electric-sql/pglite@0.3';
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';
import { buildRollback, loadPreflight, type PreflightRow } from '../../migration-scripts/0055_generate_rollback.ts';

const read = (name: string) => Deno.readTextFileSync(new URL(`../../migrations/${name}`, import.meta.url));
const readScript = (name: string) => Deno.readTextFileSync(new URL(`../../migration-scripts/${name}`, import.meta.url));

/** Preflight REAL de producción (si el CSV está en el repo). Con él, el estado previo de las pruebas usa las definiciones reales. */
const PROD: PreflightRow[] | null = (() => {
  try {
    return loadPreflight(Deno.readTextFileSync(new URL('../../migration-scripts/0055_travel_kinds_preflight_production.csv', import.meta.url)));
  } catch {
    return null;
  }
})();

/** Desde el inicio de `startPat` hasta el primer `\n$$;` posterior (inclusive). */
function block(text: string, startPat: RegExp): string {
  const m = startPat.exec(text);
  if (!m) throw new Error(`no encontrado: ${startPat}`);
  const i = text.indexOf('\n$$;', m.index);
  return text.slice(m.index, i + 4);
}

const P_ONE = '11111111-1111-4111-8111-111111111111'; // propuesta de la asesora A
const I_ONE = '22222222-2222-4222-8222-222222222222'; // itinerario de la asesora A
const I_TWO = '33333333-3333-4333-8333-333333333333'; // itinerario de la asesora B
const TOKEN_P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOKEN_I = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SESSION_P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const SESSION_I = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ADMIN = '99999999-9999-4999-8999-99999999000c';
const EDITOR = '99999999-9999-4999-8999-99999999000d';
const ADVISOR_A = '99999999-9999-4999-8999-99999999000a';
const ADVISOR_B = '99999999-9999-4999-8999-99999999000b';
const SVC = 'svc-1';

const CONTENT = JSON.stringify({
  cover: { title: 'Portada', subtitle: '', imagePath: null },
  welcome: { body: 'Hola' },
  days: [{ id: 'd1', services: [{ id: SVC }] }],
  pricing: { lines: [{ id: 'l1', label: 'x', quantity: 1, unitPrice: 100 }], feesLines: [] },
  terms: { title: 'Términos', body: 'Texto' }
});
const ITINERARY_CONTENT = JSON.stringify({
  cover: { title: 'Portada', subtitle: '', imagePath: null },
  welcome: { body: 'Hola' },
  days: [{ id: 'd1', services: [{ id: SVC }] }],
  pricing: { lines: [], feesLines: [] },
  terms: { title: 'Términos', body: 'Texto' }
});

/** Sustituye las funciones y policies del estado previo por las REALES del preflight de producción. */
async function applyProduction(db: PGlite, rows: PreflightRow[]): Promise<void> {
  const wanted = new Set(['private.app_user_role', 'public.can_manage_proposals', 'public.is_own_or_full', 'public.enforce_proposal_advisor',
    'public.enforce_credential_ownership', 'public.enforce_service_attachment', 'public.recompute_proposal_pricing',
    'public.publish_proposal', 'public.unpublish_proposal', 'public.accept_proposal', 'public.set_proposal_service_choice',
    'public.set_proposal_service_comment', 'public.get_proposal_gate', 'public.verify_proposal_access', 'public.get_proposal_content',
    'public.generate_proposal_access_code', 'public.set_proposal_access_code', 'public.proposal_has_access_code', 'public.log_proposal_created',
    'public.log_proposal_deleted', 'public.log_proposal_status_change']);
  const defs = rows.filter((r) => ['function.def', 'audit.functions', 'permissions.helper_defs'].includes(r.section) && wanted.has(r.item.split('(')[0]));
  const order = ['private.app_user_role', 'public.can_manage_proposals', 'public.is_own_or_full'];
  const rank = (r: PreflightRow) => {
    const i = order.indexOf(r.item.split('(')[0]);
    return i < 0 ? 99 : i;
  };
  defs.sort((a, b) => rank(a) - rank(b));
  const done = new Set<string>();
  for (const d of defs) {
    if (done.has(d.item)) continue;
    done.add(d.item);
    await db.exec(d.detail);
  }
  // EXECUTE reales de cada función (el preflight los trae): mismo estado previo que producción.
  for (const g of rows.filter((x) => x.section === 'function.grants')) {
    const roles = g.detail.startsWith('sin ACL') ? ['public'] : g.detail.split(', ').map((e) => e.split(':')[0]).filter((r) => r !== 'postgres');
    await db.exec(`revoke all on function ${g.item} from public, anon, authenticated, service_role`);
    if (roles.length > 0) await db.exec(`grant execute on function ${g.item} to ${roles.join(', ')}`);
  }
  // Policies reales de proposals y de los adjuntos.
  await db.exec(`drop policy if exists proposals_select on public.proposals; drop policy if exists proposals_insert on public.proposals;
    drop policy if exists proposals_update on public.proposals; drop policy if exists proposals_delete on public.proposals;
    drop policy if exists psa_select on public.proposal_service_attachments`);
  for (const r of rows.filter((x) => x.section === 'rls.policies' && ['proposals.', 'proposal_service_attachments.'].some((p) => x.item.startsWith(p)))) {
    const [table, name] = r.item.split('.');
    const p = JSON.parse(r.detail) as { command: string; roles: string[]; using: string | null; with_check: string | null };
    const to = p.roles.length === 1 && p.roles[0] === 'public' ? '' : ` to ${p.roles.join(', ')}`;
    await db.exec(`create policy ${name} on public.${table} for ${p.command.toLowerCase()}${to}${p.using ? ` using (${p.using})` : ''}${p.with_check ? ` with check (${p.with_check})` : ''}`);
  }
}

/** Estado de producción ANTES de 0055. */
async function baseline(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema extensions; create schema private; create schema auth; create schema storage;
    grant usage on schema public, extensions, private, auth to anon, authenticated, service_role;

    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    -- pgcrypto reducido: suficiente para comparar un código contra su "hash".
    create function extensions.gen_salt(text) returns text language sql as $$ select '' $$;
    create function extensions.crypt(p text, s text) returns text language sql as
      $$ select case when s like 'h:%' then 'h:' || p else 'h:' || p end $$;
    create function extensions.gen_random_bytes(n int) returns bytea language sql as
      $$ select decode(substr(md5(random()::text || clock_timestamp()::text), 1, n * 2), 'hex') $$;

    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;

    create table public.profiles (id uuid primary key, role text);
    create table public.leads (id uuid primary key, assigned_to uuid);
    create table public.audit_log (actor_id uuid, action text, entity_type text, entity_id text, summary text);

    create function private.app_user_role() returns text language sql stable security definer set search_path = '' as
      $$ select p.role from public.profiles p where p.id = auth.uid() $$;
    grant execute on function private.app_user_role() to authenticated;
    grant select on public.leads to authenticated;
    create function public.can_manage_proposals() returns boolean language sql stable security definer set search_path = '' as
      $$ select private.app_user_role() in ('admin', 'editor', 'staff') $$;
    grant execute on function public.can_manage_proposals() to authenticated;
    create function public.set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

    create table public.proposals (
      id uuid primary key default gen_random_uuid(),
      public_token uuid not null default gen_random_uuid(),
      lead_id uuid references public.leads(id) on delete set null,
      status text not null default 'draft' check (status in ('draft','published','viewed','accepted','expired')),
      client_name text not null,
      destination_text text, start_date date, end_date date, travelers_count int,
      client_email text, client_phone text, origin_channel text not null default 'other',
      feedback_sent_at timestamptz, accepted_notified_at timestamptz,
      advisor_id uuid references public.profiles(id),
      currency text not null default 'USD',
      access_required boolean not null default true,
      content jsonb not null default '{}',
      title text generated always as (content->'cover'->>'title') stored,
      cover_image_path text generated always as (content->'cover'->>'imagePath') stored,
      pricing_subtotal numeric not null default 0, pricing_fees numeric not null default 0, pricing_total numeric not null default 0,
      terms_accepted boolean not null default false, accepted_at timestamptz, accepted_by_name text,
      published_at timestamptz, viewed_at timestamptz, expires_at timestamptz,
      service_choices jsonb not null default '{}'::jsonb,
      service_comments jsonb not null default '{}'::jsonb,
      created_by uuid references public.profiles(id),
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create unique index idx_proposals_public_token on public.proposals (public_token);
    create table public.proposal_access_sessions (
      id uuid primary key default gen_random_uuid(),
      proposal_id uuid not null references public.proposals(id) on delete cascade,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null default now() + interval '2 hours',
      last_seen_at timestamptz);
    alter table public.proposal_access_sessions enable row level security;
    create table public.proposal_access_credentials (
      proposal_id uuid primary key references public.proposals(id) on delete cascade,
      access_code_hash text, access_attempts integer not null default 0, access_locked_until timestamptz,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    alter table public.proposal_access_credentials enable row level security;
    -- 0049 reducida: lo que importa para el trigger de 0055.
    create table public.proposal_imports (
      id uuid primary key default gen_random_uuid(),
      proposal_id uuid references public.proposals(id) on delete set null,
      file_path text not null default 'x.pdf',
      mode text not null check (mode in ('new', 'merge')),
      status text not null default 'uploaded',
      created_by uuid references public.profiles(id));
    alter table public.proposal_imports enable row level security;
    create policy proposal_imports_select on public.proposal_imports for select using (public.can_manage_proposals());
    create policy proposal_imports_insert on public.proposal_imports for insert with check (public.can_manage_proposals() and created_by = auth.uid());
    grant select, insert on public.proposal_imports to authenticated;

    grant select, insert, update, delete on public.proposals to authenticated;
    grant all on public.proposals, public.proposal_access_sessions, public.proposal_access_credentials to service_role;
    revoke update (public_token) on public.proposals from authenticated;
  `);

  // Definiciones REALES del repo.
  const m29 = read('0029_proposals.sql');
  const m47 = read('0047_advisor_scoped_access.sql');
  await db.exec(block(m47, /create or replace function public\.is_own_or_full/) + `\ngrant execute on function public.is_own_or_full(uuid) to authenticated;`);
  await db.exec(block(m29, /create function recompute_proposal_pricing/));
  await db.exec(`create trigger trg_proposals_recompute_pricing before insert or update on public.proposals for each row execute function recompute_proposal_pricing();
                 create trigger trg_proposals_updated_at before update on public.proposals for each row execute function set_updated_at();`);
  await db.exec(block(m47, /create or replace function public\.enforce_proposal_advisor/));
  await db.exec(`create trigger trg_enforce_proposal_advisor before insert or update on public.proposals for each row execute function public.enforce_proposal_advisor();`);
  await db.exec(read('0033_proposals_audit.sql'));
  await db.exec(`
    alter table public.proposals enable row level security;
    create policy proposals_select on public.proposals for select using (can_manage_proposals() and is_own_or_full(advisor_id));
    create policy proposals_insert on public.proposals for insert with check (can_manage_proposals() and created_by = auth.uid());
    create policy proposals_update on public.proposals for update using (can_manage_proposals() and is_own_or_full(advisor_id));
    create policy proposals_delete on public.proposals for delete using (private.app_user_role() = 'admin');
  `);
  // RPC reales previas.
  await db.exec(block(read('0031_proposals_public_rpc.sql'), /create function accept_proposal/));
  await db.exec(block(read('0043_proposal_service_choices.sql'), /create or replace function set_proposal_service_choice/));
  await db.exec(block(read('0044_proposal_service_comments.sql'), /create or replace function set_proposal_service_comment/));
  await db.exec(block(read('0044_proposal_service_comments.sql'), /create function get_proposal_content/));
  await db.exec(block(read('0038_proposal_access_code_generation.sql'), /create function generate_proposal_access_code/));
  await db.exec(block(read('0032_proposals_admin_rpc.sql'), /create function unpublish_proposal/));
  const m51 = read('0051_proposal_link_expiry_asks_for_code.sql');
  await db.exec(block(m51, /create or replace function public\.get_proposal_gate/));
  await db.exec(block(m51, /create or replace function public\.verify_proposal_access/));
  await db.exec(`
    grant execute on function public.get_proposal_gate(uuid), public.verify_proposal_access(uuid, text), public.get_proposal_content(uuid, uuid),
      public.accept_proposal(uuid, uuid, text), public.set_proposal_service_choice(uuid, uuid, text, boolean),
      public.set_proposal_service_comment(uuid, uuid, text, text) to anon, authenticated;
    grant execute on function public.unpublish_proposal(uuid), public.generate_proposal_access_code(uuid) to authenticated;
    revoke execute on function public.get_proposal_gate(uuid), public.verify_proposal_access(uuid, text), public.get_proposal_content(uuid, uuid),
      public.accept_proposal(uuid, uuid, text), public.set_proposal_service_choice(uuid, uuid, text, boolean),
      public.set_proposal_service_comment(uuid, uuid, text, text) from public;
  `);
  await db.exec(block(read('0035_proposal_access_credentials.sql'), /create or replace function publish_proposal/));
  await db.exec(block(m47, /create or replace function public\.enforce_credential_ownership/));
  await db.exec(`create trigger trg_enforce_credential_ownership before insert or update on public.proposal_access_credentials for each row execute function public.enforce_credential_ownership();
    grant execute on function public.publish_proposal(uuid) to authenticated; revoke execute on function public.publish_proposal(uuid) from public;`);
  await db.exec(read('0054_proposal_service_attachments.sql'));
  await db.exec(block(read('0035_proposal_access_credentials.sql'), /create or replace function set_proposal_access_code/));
  await db.exec(block(read('0038_proposal_access_code_generation.sql'), /create function proposal_has_access_code/));
  await db.exec(`grant execute on function public.proposal_has_access_code(uuid) to authenticated; revoke execute on function public.proposal_has_access_code(uuid) from public`);
  await db.exec(`grant execute on function public.set_proposal_access_code(uuid, text) to authenticated;
    revoke execute on function public.set_proposal_access_code(uuid, text) from public;
    revoke execute on function public.recompute_proposal_pricing() from public;
    revoke execute on function public.unpublish_proposal(uuid), public.generate_proposal_access_code(uuid) from public;`);
  if (PROD) await applyProduction(db, PROD);

  await db.exec(`
    insert into public.profiles values ('${ADMIN}', 'admin'), ('${EDITOR}', 'editor'), ('${ADVISOR_A}', 'staff'), ('${ADVISOR_B}', 'staff');
    -- Fila LEGACY: creada antes de 0055 (sin kind), publicada y con código.
    insert into public.proposals (id, public_token, status, client_name, advisor_id, created_by, content, published_at)
      values ('${P_ONE}', '${TOKEN_P}', 'published', 'Persona Legacy', '${ADVISOR_A}', '${ADVISOR_A}', '${CONTENT}'::jsonb, now());
    insert into public.proposal_access_sessions (id, proposal_id) values ('${SESSION_P}', '${P_ONE}');
  `);
  return db;
}

/** Baseline + 0055. */
async function migrated(): Promise<PGlite> {
  const db = await baseline();
  await db.exec(read('0055_travel_kinds.sql'));
  await db.exec(`
    insert into public.proposals (id, public_token, kind, status, client_name, advisor_id, created_by, content)
      values ('${I_ONE}', '${TOKEN_I}', 'itinerary', 'draft', 'Persona Itinerario', '${ADVISOR_A}', '${ADVISOR_A}', '${ITINERARY_CONTENT}'::jsonb),
             ('${I_TWO}', gen_random_uuid(), 'itinerary', 'draft', 'Otra Persona', '${ADVISOR_B}', '${ADVISOR_B}', '${ITINERARY_CONTENT}'::jsonb);
  `);
  return db;
}

async function asUser<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  await db.exec(`select set_config('app.uid', '${uid}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`select set_config('app.uid', '', false)`);
  }
}

const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
const setStatus = (db: PGlite, id: string, status: string) => db.exec(`update public.proposals set status = '${status}' where id = '${id}'`);
/** Un itinerario compartido/visto exige shared_at (lo escribirá share_itinerary en 0056; aquí se simula como dueño de la base). */
const share = (db: PGlite, id: string, status = 'shared') =>
  db.exec(`update public.proposals set status = '${status}', shared_at = now() where id = '${id}'`);
const rejects = (fn: () => Promise<unknown>, msg: string) => assertRejects(fn, Error, msg);


// ---------------------------------------------------------------- columnas, defaults y constraints
Deno.test('0055: legacy → proposal, con shared_at nulo y sin tocar content, status ni credenciales', async () => {
  const before = await baseline();
  await before.exec(`insert into public.proposal_access_credentials (proposal_id, access_code_hash) values ('${P_ONE}', 'h:TRV-X')`);
  const h = () => one<{ h: string }>(before, `select md5(p.content::text || p.status || coalesce(p.published_at::text, '') || c.access_code_hash) h
                                              from public.proposals p join public.proposal_access_credentials c on c.proposal_id = p.id where p.id = '${P_ONE}'`);
  const snapshot = await h();
  await before.exec(read('0055_travel_kinds.sql'));
  const row = await one<{ kind: string; shared_at: string | null; status: string }>(before, `select kind, shared_at, status from public.proposals where id = '${P_ONE}'`);
  assertEquals([row.kind, row.shared_at, row.status], ['proposal', null, 'published']);
  assertEquals((await h()).h, snapshot.h);
});

Deno.test('0055: default proposal, proposal explícita, itinerary explícito y kind inválido', async () => {
  const db = await migrated();
  const ins = (kind: string | null) =>
    db.query<{ kind: string }>(
      `insert into public.proposals (client_name, ${kind ? 'kind,' : ''} advisor_id, created_by) values ('X', ${kind ? `'${kind}',` : ''} '${ADVISOR_A}', '${ADVISOR_A}') returning kind`);
  assertEquals((await ins(null)).rows[0].kind, 'proposal');
  assertEquals((await ins('proposal')).rows[0].kind, 'proposal');
  assertEquals((await ins('itinerary')).rows[0].kind, 'itinerary');
  await rejects(() => ins('trip'), 'proposals_kind_check');
  await assertRejects(() => db.exec(`insert into public.proposals (client_name, kind) values ('X', null)`), Error);
});

Deno.test('0055: kind es inmutable', async () => {
  const db = await migrated();
  await rejects(() => db.exec(`update public.proposals set kind = 'itinerary' where id = '${P_ONE}'`), 'kind_immutable');
  await rejects(() => db.exec(`update public.proposals set kind = 'proposal' where id = '${I_ONE}'`), 'kind_immutable');
  await db.exec(`update public.proposals set client_name = 'Cambio' where id = '${I_ONE}'`);
  // authenticated ni siquiera tiene privilegio para escribir kind en un UPDATE.
  await asUser(db, ADMIN, async () => {
    await rejects(() => db.exec(`update public.proposals set kind = 'itinerary' where id = '${P_ONE}'`), 'permission denied');
  });
});

Deno.test('0055: CHECK compuesto de estados — proposal e itinerary', async () => {
  const db = await migrated();
  for (const ok of ['draft', 'published', 'viewed', 'accepted', 'expired']) {
    await db.exec(`update public.proposals set status = '${ok}', ${ok === 'accepted' ? 'terms_accepted = true, accepted_at = now(),' : ''} published_at = now() where id = '${P_ONE}'`);
  }
  await rejects(() => setStatus(db, P_ONE, 'shared'), 'proposals_kind_status_check');
  await rejects(() => setStatus(db, P_ONE, 'bogus'), 'proposals_kind_status_check');
  await share(db, I_ONE);
  await share(db, I_ONE, 'viewed');
  await db.exec(`update public.proposals set status = 'draft', shared_at = null where id = '${I_ONE}'`);
  for (const bad of ['accepted', 'published', 'expired']) {
    // Lo rechaza el CHECK de estado o el de forma (según cuál evalúe primero Postgres): un itinerario nunca está en esos estados.
    await rejects(() => setStatus(db, I_ONE, bad), 'violates check constraint');
  }
});

Deno.test('0055: invariantes — propuesta sin shared_at; itinerario sin published_at, aceptación, precios, elecciones; shared ⇔ shared_at', async () => {
  const db = await migrated();
  await rejects(() => db.exec(`update public.proposals set shared_at = now() where id = '${P_ONE}'`), 'proposals_kind_shape_check');
  for (const set of ['published_at = now()', 'accepted_at = now()', `accepted_by_name = 'X'`, 'terms_accepted = true',
                     `service_choices = '{"a": true}'`, `service_comments = '{"a": "x"}'`]) {
    await rejects(() => db.exec(`update public.proposals set ${set} where id = '${I_ONE}'`), 'proposals_kind_shape_check');
  }
  await rejects(() => setStatus(db, I_ONE, 'shared'), 'proposals_kind_shape_check'); // shared sin shared_at
  await rejects(() => setStatus(db, I_ONE, 'viewed'), 'proposals_kind_shape_check');
  await rejects(() => db.exec(`update public.proposals set shared_at = now() where id = '${I_ONE}'`), 'proposals_kind_shape_check'); // draft con shared_at
  await share(db, I_ONE);
});

Deno.test('0055: trigger de precios — la propuesta sigue calculando; el itinerario siempre 0 aunque el content traiga líneas', async () => {
  const db = await migrated();
  assertEquals(Number((await one<{ t: string }>(db, `select pricing_total t from public.proposals where id = '${P_ONE}'`)).t), 100);
  await db.exec(`update public.proposals set content = '${CONTENT.replace('"quantity":1', '"quantity":3')}'::jsonb where id = '${P_ONE}'`);
  assertEquals(Number((await one<{ t: string }>(db, `select pricing_total t from public.proposals where id = '${P_ONE}'`)).t), 300);
  await db.exec(`update public.proposals set content = '${CONTENT}'::jsonb where id = '${I_ONE}'`);
  const row = await one<{ s: string; f: string; t: string }>(db, `select pricing_subtotal s, pricing_fees f, pricing_total t from public.proposals where id = '${I_ONE}'`);
  assertEquals([Number(row.s), Number(row.f), Number(row.t)], [0, 0, 0]);
  const ins = await one<{ t: string }>(db, `insert into public.proposals (client_name, kind, content, created_by, advisor_id)
    values ('Y', 'itinerary', '${CONTENT}'::jsonb, '${ADVISOR_A}', '${ADVISOR_A}') returning pricing_total t`);
  assertEquals(Number(ins.t), 0);
});

// ---------------------------------------------------------------- listados y RLS
Deno.test('0055: los listados por tipo están separados (kind) y la RLS es por tipo y asesora', async () => {
  const db = await migrated();
  const ids = (kind: string, uid: string) =>
    asUser(db, uid, async () => (await db.query<{ id: string }>(`select id from public.proposals where kind = '${kind}' order by id`)).rows.map((r) => r.id));
  assertEquals(await ids('proposal', ADMIN), [P_ONE]);
  assertEquals(await ids('itinerary', ADMIN), [I_ONE, I_TWO]);
  assertEquals(await ids('itinerary', EDITOR), [I_ONE, I_TWO]);
  assertEquals(await ids('itinerary', ADVISOR_A), [I_ONE]);
  assertEquals(await ids('itinerary', ADVISOR_B), [I_TWO]);
  assertEquals(await ids('proposal', ADVISOR_B), []);
});

Deno.test('0055: crear/editar según permiso; sin rol no se ve ni se crea', async () => {
  const db = await migrated();
  const NO_ROLE = '99999999-9999-4999-8999-0000000000ee';
  await db.exec(`insert into public.profiles values ('${NO_ROLE}', null)`);
  const create = (uid: string, kind: string) =>
    asUser(db, uid, () => db.exec(`insert into public.proposals (client_name, kind, created_by) values ('N', '${kind}', '${uid}')`));
  for (const kind of ['proposal', 'itinerary']) {
    await create(ADMIN, kind);
    await create(EDITOR, kind);
    await create(ADVISOR_A, kind);
    await rejects(() => create(NO_ROLE, kind), 'row-level security');
  }
  const edit = (uid: string, id: string) => asUser(db, uid, async () => (await db.query(`update public.proposals set client_name = 'E' where id = '${id}' returning id`)).rows.length);
  assertEquals(await edit(ADVISOR_A, I_ONE), 1);
  assertEquals(await edit(ADVISOR_B, I_ONE), 0); // el itinerario es de la asesora A
  assertEquals(await edit(EDITOR, I_ONE), 1);
  assertEquals(await edit(NO_ROLE, I_ONE), 0);
  // UPDATE con WITH CHECK: la asesora no puede pasarle SU itinerario a otra asesora.
  await asUser(db, ADVISOR_A, async () => {
    await assertRejects(() => db.exec(`update public.proposals set advisor_id = '${ADVISOR_B}' where id = '${I_ONE}'`), Error);
  });
});

Deno.test('0055: eliminar — editor y staff NO; admin SÍ (propuesta e itinerario)', async () => {
  const db = await migrated();
  const del = (uid: string, id: string) => asUser(db, uid, async () => (await db.query(`delete from public.proposals where id = '${id}' returning id`)).rows.length);
  for (const uid of [EDITOR, ADVISOR_A]) {
    assertEquals(await del(uid, I_ONE), 0);
    assertEquals(await del(uid, P_ONE), 0);
  }
  assertEquals(await del(ADMIN, I_ONE), 1);
  assertEquals(await del(ADMIN, P_ONE), 1);
});

Deno.test('0055: can_travel — mapeo de compatibilidad y tipos/acciones desconocidos', async () => {
  const db = await migrated();
  const can = (uid: string, kind: string, action: string) =>
    asUser(db, uid, async () => (await one<{ c: boolean }>(db, `select public.can_travel('${kind}', '${action}') c`)).c);
  for (const kind of ['proposal', 'itinerary']) {
    for (const a of ['ver', 'crear', 'editar', 'gestionar_documentos']) {
      for (const uid of [ADMIN, EDITOR, ADVISOR_A]) assertEquals(await can(uid, kind, a), true, `${uid} ${kind} ${a}`);
    }
    assertEquals(await can(ADMIN, kind, 'eliminar'), true);
    assertEquals(await can(EDITOR, kind, 'eliminar'), false);
    assertEquals(await can(ADVISOR_A, kind, 'eliminar'), false);
  }
  assertEquals(await can(ADMIN, 'itinerary', 'publicar'), false);
  assertEquals(await can(ADMIN, 'proposal', 'compartir'), false);
  assertEquals(await can(ADMIN, 'itinerary', 'compartir'), false); // llega en 0056
  assertEquals(await can(ADMIN, 'trip', 'ver'), false);
  assertEquals(await can('99999999-9999-4999-8999-0000000000ff', 'proposal', 'ver'), false);
});

// ---------------------------------------------------------------- hardening de privilegios
Deno.test('0055: authenticated NO puede saltarse las RPC escribiendo estados, fechas, aceptación ni elecciones', async () => {
  const db = await migrated();
  const writes = [
    `status = 'accepted'`, `status = 'published'`, `published_at = now()`, `viewed_at = now()`, `accepted_at = now()`,
    `accepted_by_name = 'X'`, `terms_accepted = true`, `service_choices = '{"a": true}'`, `service_comments = '{"a": "x"}'`,
    `shared_at = now()`, `public_token = gen_random_uuid()`, `pricing_total = 1`, `created_by = '${ADMIN}'`
  ];
  for (const uid of [ADMIN, EDITOR, ADVISOR_A]) {
    await asUser(db, uid, async () => {
      for (const w of writes) {
        await rejects(() => db.exec(`update public.proposals set ${w} where id = '${P_ONE}'`), 'permission denied');
      }
      await rejects(() => db.exec(`insert into public.proposals (client_name, created_by, status) values ('X', '${uid}', 'accepted')`), 'permission denied');
      await rejects(() => db.exec(`insert into public.proposals (client_name, created_by, accepted_at) values ('X', '${uid}', now())`), 'permission denied');
    });
  }
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'published');
});

Deno.test('0055: authenticated SÍ escribe lo que usa el panel (datos, content, acceso) y crea con kind', async () => {
  const db = await migrated();
  await asUser(db, ADVISOR_A, async () => {
    await db.exec(`update public.proposals set client_name = 'N', client_email = 'a@b.co', destination_text = 'D', start_date = '2030-01-01',
      end_date = '2030-01-09', travelers_count = 2, currency = 'EUR', access_required = false, expires_at = now() + interval '1 day',
      content = '${CONTENT}'::jsonb where id = '${P_ONE}'`);
    await db.exec(`insert into public.proposals (client_name, lead_id, origin_channel, destination_text, travelers_count, start_date, end_date, content, created_by, kind)
      values ('Z', null, 'web', 'D', 1, '2030-01-01', '2030-01-02', '${ITINERARY_CONTENT}'::jsonb, '${ADVISOR_A}', 'itinerary')`);
    assertEquals((await db.query(`select id from public.proposals where client_name = 'Z'`)).rows.length, 1);
  });
});

Deno.test('0055: anon no tiene ningún privilegio sobre proposals', async () => {
  const db = await migrated();
  await db.exec('set role anon');
  try {
    await rejects(() => db.exec(`select * from public.proposals`), 'permission denied');
    await rejects(() => db.exec(`update public.proposals set client_name = 'x'`), 'permission denied');
    await rejects(() => db.exec(`insert into public.proposals (client_name) values ('x')`), 'permission denied');
  } finally {
    await db.exec('reset role');
  }
});

Deno.test('0055: las funciones de trigger no son ejecutables por nadie, y los triggers siguen funcionando', async () => {
  const db = await migrated();
  for (const fn of ['recompute_proposal_pricing', 'enforce_proposal_advisor', 'enforce_credential_ownership', 'enforce_proposal_kind_immutable',
                    'enforce_import_targets_proposal']) {
    // (log_proposal_* se comprueban aparte: su ACL real es postgres + service_role.)
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assertRejects(() => db.exec(`select public.${fn}()`), Error, 'permission denied');
      await db.exec('reset role');
    }
  }
  await asUser(db, ADVISOR_A, () => db.exec(`insert into public.proposals (client_name, created_by, content) values ('T', '${ADVISOR_A}', '${CONTENT}'::jsonb)`));
  const row = await one<{ advisor_id: string; pricing_total: string }>(db, `select advisor_id, pricing_total from public.proposals where client_name = 'T'`);
  assertEquals([row.advisor_id, Number(row.pricing_total)], [ADVISOR_A, 100]);
  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.audit_log where summary = 'Creó la propuesta para "T"'`)).n, 1);
});

// ---------------------------------------------------------------- RPC comerciales
Deno.test('0055: publish / unpublish rechazan un itinerario con kind_not_supported; la propuesta conserva su comportamiento', async () => {
  const db = await migrated();
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`select public.publish_proposal('${I_ONE}')`), 'kind_not_supported');
  });
  await share(db, I_ONE, 'viewed');
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`select public.unpublish_proposal('${I_ONE}')`), 'kind_not_supported');
  });
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${I_ONE}'`)).status, 'viewed');

  await asUser(db, ADVISOR_A, () => db.exec(`select public.unpublish_proposal('${P_ONE}')`));
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'draft');
  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposal_access_sessions where proposal_id = '${P_ONE}'`)).n, 0);
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`select public.unpublish_proposal('${P_ONE}')`), 'La propuesta no está publicada');
    await rejects(() => db.exec(`select public.publish_proposal('${P_ONE}')`), 'código de acceso');
  });
  await db.exec(`update public.proposals set status = 'accepted', terms_accepted = true, accepted_at = now() where id = '${P_ONE}'`);
  await asUser(db, ADVISOR_A, async () => {
    await rejects(() => db.exec(`select public.unpublish_proposal('${P_ONE}')`), 'La propuesta no está publicada');
    await rejects(() => db.exec(`select public.publish_proposal('${P_ONE}')`), 'estado draft');
  });
});

Deno.test('0055: publicar una propuesta completa sigue funcionando y fija published_at (no shared_at)', async () => {
  const db = await migrated();
  await db.exec(`update public.proposals set status = 'draft', published_at = null, access_required = false where id = '${P_ONE}'`);
  await asUser(db, ADVISOR_A, () => db.exec(`select public.publish_proposal('${P_ONE}')`));
  const row = await one<{ status: string; published_at: string | null; shared_at: string | null }>(db, `select status, published_at, shared_at from public.proposals where id = '${P_ONE}'`);
  assertEquals([row.status, row.published_at !== null, row.shared_at], ['published', true, null]);
});

Deno.test('0055: publicar/despublicar — admin y editor cualquiera; la asesora solo las suyas (explícito, no solo por trigger)', async () => {
  const db = await migrated();
  // P_ONE (publicada) es de la asesora A.
  await asUser(db, ADVISOR_B, async () => {
    await rejects(() => db.exec(`select public.unpublish_proposal('${P_ONE}')`), 'pertenece a otra asesora');
  });
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'published');
  await asUser(db, EDITOR, () => db.exec(`select public.unpublish_proposal('${P_ONE}')`)); // editor: sí
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'draft');
  await db.exec(`update public.proposals set access_required = false where id = '${P_ONE}'`);
  await asUser(db, ADVISOR_B, async () => {
    await rejects(() => db.exec(`select public.publish_proposal('${P_ONE}')`), 'pertenece a otra asesora');
  });
  await asUser(db, ADVISOR_A, () => db.exec(`select public.publish_proposal('${P_ONE}')`)); // la dueña: sí
  await asUser(db, ADMIN, () => db.exec(`select public.unpublish_proposal('${P_ONE}')`)); // admin: sí
  assertEquals((await one<{ status: string }>(db, `select status from public.proposals where id = '${P_ONE}'`)).status, 'draft');
});

Deno.test('0055: código de acceso — set y generate funcionan para ambos tipos y auditan por tipo; no hay acceso entre asesoras', async () => {
  const db = await migrated();
  await db.exec(`delete from public.audit_log`);
  await asUser(db, ADVISOR_A, async () => {
    await db.exec(`select public.set_proposal_access_code('${I_ONE}', 'CODIGO-ITIN')`);
    await db.exec(`select public.set_proposal_access_code('${P_ONE}', 'CODIGO-PROP')`);
    assertEquals((await one<{ r: boolean }>(db, `select public.proposal_has_access_code('${I_ONE}') r`)).r, true);
    await rejects(() => db.exec(`select public.set_proposal_access_code('${I_TWO}', 'CODIGO-AJENO')`), 'pertenece a otra asesora'); // itinerario de B
    await rejects(() => db.exec(`select public.generate_proposal_access_code('${I_TWO}')`), 'pertenece a otra asesora');
    await rejects(() => db.exec(`select public.set_proposal_access_code('${I_ONE}', 'corto')`), 'al menos 6 caracteres');
    await rejects(() => db.exec(`select public.set_proposal_access_code('${crypto.randomUUID()}', 'CODIGO-X')`), 'Propuesta no encontrada');
  });
  const rows = (await db.query<{ action: string; entity_type: string; summary: string }>(`select action, entity_type, summary from public.audit_log order by summary`)).rows;
  assert(rows.some((r) => r.action === 'itinerary_access_code_changed' && r.entity_type === 'itinerary' && r.summary === 'Cambió el código de acceso del itinerario'));
  assert(rows.some((r) => r.action === 'proposal_access_code_changed' && r.entity_type === 'proposal' && r.summary === 'Cambió el código de acceso de la propuesta'));
  // El código del itinerario abre el gate cuando se comparte (mismo mecanismo).
  await share(db, I_ONE);
  await db.exec('set role anon');
  const ok = await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', 'CODIGO-ITIN')`);
  await db.exec('reset role');
  assertEquals(ok.result, 'ok');
});

Deno.test('0055: aceptar, elegir servicio y comentar → kind_not_supported para un itinerario (compartido o visto, con sesión válida)', async () => {
  const db = await migrated();
  await db.exec(`insert into public.proposal_access_sessions (id, proposal_id) values ('${SESSION_I}', '${I_ONE}')`);
  for (const status of ['shared', 'viewed']) {
    await share(db, I_ONE, status);
    await db.exec('set role anon');
    try {
      await rejects(() => db.exec(`select public.accept_proposal('${TOKEN_I}', '${SESSION_I}', 'Persona')`), 'kind_not_supported');
      await rejects(() => db.exec(`select public.set_proposal_service_choice('${TOKEN_I}', '${SESSION_I}', '${SVC}', true)`), 'kind_not_supported');
      await rejects(() => db.exec(`select public.set_proposal_service_comment('${TOKEN_I}', '${SESSION_I}', '${SVC}', 'hola')`), 'kind_not_supported');
      await rejects(() => db.exec(`select public.accept_proposal('${TOKEN_I}', '${SESSION_P}', 'Persona')`), 'session_invalid');
    } finally {
      await db.exec('reset role');
    }
  }
  const row = await one<{ status: string; service_choices: unknown; service_comments: unknown; terms_accepted: boolean }>(
    db, `select status, service_choices, service_comments, terms_accepted from public.proposals where id = '${I_ONE}'`);
  assertEquals([row.status, row.service_choices, row.service_comments, row.terms_accepted], ['viewed', {}, {}, false]);
});

Deno.test('0055: la propuesta conserva TODO el comportamiento de aceptar, elegir y comentar', async () => {
  const db = await migrated();
  await db.exec('set role anon');
  try {
    await db.exec(`select public.set_proposal_service_choice('${TOKEN_P}', '${SESSION_P}', '${SVC}', true)`);
    await rejects(() => db.exec(`select public.set_proposal_service_choice('${TOKEN_P}', '${SESSION_P}', 'no-existe', true)`), 'service_not_found');
    await db.exec(`select public.set_proposal_service_comment('${TOKEN_P}', '${SESSION_P}', '${SVC}', '  hola  ')`);
    await rejects(() => db.exec(`select public.set_proposal_service_comment('${TOKEN_P}', '${SESSION_P}', '${SVC}', '${'x'.repeat(1001)}')`), 'comment_too_long');
    await rejects(() => db.exec(`select public.accept_proposal('${TOKEN_P}', '${SESSION_P}', '   ')`), 'accepted_by_name_required');
    await rejects(() => db.exec(`select public.accept_proposal('${TOKEN_P}', '${SESSION_I}', 'X')`), 'session_invalid');
  } finally {
    await db.exec('reset role');
  }
  let r = await one<{ service_choices: Record<string, boolean>; service_comments: Record<string, string> }>(db, `select service_choices, service_comments from public.proposals where id = '${P_ONE}'`);
  assertEquals([r.service_choices[SVC], r.service_comments[SVC]], [true, 'hola']);
  await db.exec('set role anon');
  await db.exec(`select public.set_proposal_service_comment('${TOKEN_P}', '${SESSION_P}', '${SVC}', '')`); // vacío borra
  await db.exec(`select public.accept_proposal('${TOKEN_P}', '${SESSION_P}', ' Persona ')`);
  await rejects(() => db.exec(`select public.accept_proposal('${TOKEN_P}', '${SESSION_P}', 'Persona')`), 'cannot_accept_in_current_status');
  await rejects(() => db.exec(`select public.set_proposal_service_choice('${TOKEN_P}', '${SESSION_P}', '${SVC}', false)`), 'session_invalid'); // aceptada: ya no se cambia
  await db.exec('reset role');
  r = await one(db, `select service_choices, service_comments from public.proposals where id = '${P_ONE}'`);
  assertEquals(r.service_comments, {});
  const p = await one<{ status: string; terms_accepted: boolean; accepted_by_name: string }>(db, `select status, terms_accepted, accepted_by_name from public.proposals where id = '${P_ONE}'`);
  assertEquals([p.status, p.terms_accepted, p.accepted_by_name], ['accepted', true, 'Persona']);
});

// ---------------------------------------------------------------- acceso privado compartido
Deno.test('0055: acceso privado de un itinerario — gate, código, sesión y contenido sin datos comerciales', async () => {
  const db = await migrated();
  const code = await asUser(db, ADVISOR_A, async () =>
    (await one<{ generate_proposal_access_code: string }>(db, `select public.generate_proposal_access_code('${I_ONE}')`)).generate_proposal_access_code);
  assert(code.startsWith('TRV-'));
  await db.exec('set role anon');
  assertEquals((await db.query(`select * from public.get_proposal_gate('${TOKEN_I}')`)).rows.length, 0); // borrador: no visible
  await db.exec('reset role');

  await share(db, I_ONE);
  await db.exec('set role anon');
  const gate = await one<{ access_required: boolean; kind: string; status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_I}')`);
  assertEquals([gate.access_required, gate.kind, gate.status], [true, 'itinerary', 'shared']);
  const bad = await one<{ result: string; session_token: string | null }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', 'TRV-MALO')`);
  assertEquals([bad.result, bad.session_token], ['invalid_code', null]);
  const ok = await one<{ result: string; session_token: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', '${code}')`);
  assertEquals(ok.result, 'ok');
  const c = await one<{
    content: Record<string, unknown>; kind: string; status: string; pricing_subtotal: string; pricing_fees: string; pricing_total: string;
    terms_accepted: boolean; accepted_at: string | null; service_choices: unknown; service_comments: unknown;
  }>(db, `select * from public.get_proposal_content('${TOKEN_I}', '${ok.session_token}')`);
  await db.exec('reset role');
  assertEquals([c.kind, c.status], ['itinerary', 'viewed']);
  assertEquals(Object.keys(c.content).sort(), ['cover', 'days', 'welcome']); // sin pricing ni terms
  assertEquals([Number(c.pricing_subtotal), Number(c.pricing_fees), Number(c.pricing_total)], [0, 0, 0]);
  assertEquals([c.terms_accepted, c.accepted_at, c.service_choices, c.service_comments], [false, null, {}, {}]);
  const row = await one<{ viewed_at: string | null; shared_at: string | null }>(db, `select viewed_at, shared_at from public.proposals where id = '${I_ONE}'`);
  assert(row.viewed_at !== null && row.shared_at !== null);
});

Deno.test('0055: gate y contenido de una propuesta, intactos (con kind)', async () => {
  const db = await migrated();
  await db.exec('set role anon');
  const gate = await one<{ kind: string; status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_P}')`);
  assertEquals([gate.kind, gate.status], ['proposal', 'published']);
  const c = await one<{ content: Record<string, unknown>; kind: string; pricing_total: string; status: string }>(
    db, `select * from public.get_proposal_content('${TOKEN_P}', '${SESSION_P}')`);
  await db.exec('reset role');
  assertEquals([c.kind, c.status, Number(c.pricing_total)], ['proposal', 'viewed', 100]);
  assert('pricing' in c.content && 'terms' in c.content);
  await db.exec(`update public.proposals set status = 'accepted', terms_accepted = true, accepted_at = now() where id = '${P_ONE}'`);
  await db.exec('set role anon');
  assertEquals((await one<{ status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_P}')`)).status, 'accepted');
  await db.exec('reset role');
});

Deno.test('0055: un itinerario expirado no abre (se calcula al leer, como en propuestas)', async () => {
  const db = await migrated();
  await share(db, I_ONE);
  await db.exec(`update public.proposals set expires_at = now() - interval '1 hour' where id = '${I_ONE}'`);
  await db.exec('set role anon');
  assertEquals((await one<{ status: string }>(db, `select * from public.get_proposal_gate('${TOKEN_I}')`)).status, 'expired');
  assertEquals((await one<{ result: string }>(db, `select * from public.verify_proposal_access('${TOKEN_I}', 'x')`)).result, 'expired');
  await db.exec('reset role');
});

// ---------------------------------------------------------------- documentos
Deno.test('0055: documentos — funcionan con un itinerario; una asesora NO lee los de otra (ni de propuesta ni de itinerario)', async () => {
  const db = await migrated();
  await db.exec('set role service_role');
  const att = (id: string, name: string) => db.exec(`insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size)
                 values ('${id}', '${SVC}', '${name}', '${id}/${SVC}/${name}', 'application/pdf', 100)`);
  await att(I_ONE, 'itin-A.pdf');
  await att(P_ONE, 'prop-A.pdf');
  await att(I_TWO, 'itin-B.pdf');
  await assertRejects(() => db.exec(`insert into public.proposal_service_attachments (proposal_id, service_id, file_name, storage_path, mime_type, file_size)
                 values ('${I_ONE}', 'no-existe', 'x.pdf', 'p', 'application/pdf', 1)`), Error, 'service_not_found');
  await db.exec('reset role');
  const visible = (uid: string) => asUser(db, uid, async () => (await db.query<{ file_name: string }>(`select file_name from public.proposal_service_attachments order by file_name`)).rows.map((r) => r.file_name));
  assertEquals(await visible(ADVISOR_A), ['itin-A.pdf', 'prop-A.pdf']);
  assertEquals(await visible(ADVISOR_B), ['itin-B.pdf']);
  assertEquals(await visible(ADMIN), ['itin-A.pdf', 'itin-B.pdf', 'prop-A.pdf']);
  assertEquals(await visible(EDITOR), ['itin-A.pdf', 'itin-B.pdf', 'prop-A.pdf']);
  await asUser(db, ADMIN, () => db.exec(`delete from public.proposals where id = '${I_ONE}'`));
  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposal_service_attachments where proposal_id = '${I_ONE}'`)).n, 0);
});

// ---------------------------------------------------------------- importación de PDF
Deno.test('0055: la importación solo puede apuntar a una propuesta (merge o new con proposal_id)', async () => {
  const db = await migrated();
  const imp = (proposalId: string | null, mode = 'merge') =>
    db.exec(`insert into public.proposal_imports (proposal_id, mode, created_by) values (${proposalId ? `'${proposalId}'` : 'null'}, '${mode}', '${ADMIN}')`);
  await imp(P_ONE);
  await imp(null, 'new');
  await rejects(() => imp(I_ONE), 'import_requires_proposal');
  await rejects(() => imp(I_ONE, 'new'), 'import_requires_proposal');
  const id = (await one<{ id: string }>(db, `select id from public.proposal_imports where proposal_id is null`)).id;
  await rejects(() => db.exec(`update public.proposal_imports set proposal_id = '${I_ONE}' where id = '${id}'`), 'import_requires_proposal');
  await db.exec(`update public.proposal_imports set proposal_id = '${P_ONE}' where id = '${id}'`);
  await asUser(db, ADMIN, async () => {
    await rejects(() => db.exec(`insert into public.proposal_imports (proposal_id, mode, created_by) values ('${I_ONE}', 'merge', '${ADMIN}')`), 'import_requires_proposal');
  });
});

// ---------------------------------------------------------------- auditoría
Deno.test('0055: la auditoría — propuesta con sus textos de siempre; itinerario con entity_type itinerary y sin eventos falsos', async () => {
  const db = await migrated();
  await db.exec(`delete from public.audit_log`);
  await db.exec(`insert into public.proposals (client_name, kind, advisor_id, created_by) values ('Ana', 'itinerary', '${ADVISOR_A}', '${ADVISOR_A}'), ('Beto', 'proposal', '${ADVISOR_A}', '${ADVISOR_A}')`);
  await db.exec(`update public.proposals set status = 'viewed' where id = '${P_ONE}'`);
  await db.exec(`delete from public.proposals where id = '${I_TWO}'`);
  const rows = (await db.query<{ action: string; entity_type: string; summary: string }>(`select action, entity_type, summary from public.audit_log order by summary`)).rows;
  const find = (summary: string) => rows.find((r) => r.summary === summary);
  assertEquals(find('Creó el itinerario para "Ana"'), { action: 'itinerary_created', entity_type: 'itinerary', summary: 'Creó el itinerario para "Ana"' });
  assertEquals(find('Creó la propuesta para "Beto"')?.entity_type, 'proposal');
  assertEquals(find('El cliente visualizó la propuesta para "Persona Legacy"')?.action, 'proposal_status_changed');
  assertEquals(find('Eliminó el itinerario de "Otra Persona"')?.entity_type, 'itinerary');
  assertEquals(rows.length, 4); // ningún evento de compartir/visto para un itinerario borrador
});

// ---------------------------------------------------------------- requisitos reales
Deno.test('0055: sin tabla/función/columna requerida, la migración se detiene con un mensaje claro (no depende de 0053)', async () => {
  const db = await baseline();
  await db.exec(`drop function public.is_own_or_full(uuid) cascade`);
  await rejects(() => db.exec(read('0055_travel_kinds.sql')), 'public.is_own_or_full(uuid)');
  const db2 = await baseline();
  await db2.exec(`alter table public.proposals drop column service_comments`);
  await rejects(() => db2.exec(read('0055_travel_kinds.sql')), 'public.proposals.service_comments');
  const db3 = await baseline();
  await db3.exec(`alter table public.audit_log add constraint audit_log_entity_type_check check (entity_type in ('proposal', 'lead'))`);
  await rejects(() => db3.exec(read('0055_travel_kinds.sql')), 'no admite');
  // Sin get_publish_readiness (0053 sin aplicar, como en producción) SÍ se aplica.
  const db4 = await baseline();
  assertEquals((await one<{ t: string | null }>(db4, `select to_regprocedure('public.get_publish_readiness(uuid)')::text t`)).t, null);
  await db4.exec(read('0055_travel_kinds.sql'));
});

// ---------------------------------------------------------------- verify
Deno.test('0055: el verify da ok en las 27 comprobaciones', async () => {
  const db = await baseline();
  await db.exec(read('0055_travel_kinds.sql'));
  const { rows } = await db.query<{ n: number; check: string; ok: boolean }>(readScript('0055_travel_kinds_verify.sql'));
  assertEquals(rows.length, 28);
  assertEquals(rows.filter((r) => !r.ok).map((r) => `${r.n} ${r.check}`), []);
});

Deno.test('0055: el verify FALLA si falta el hardening o una función de trigger queda ejecutable', async () => {
  const db = await baseline();
  await db.exec(read('0055_travel_kinds.sql'));
  await db.exec(`grant update (status) on public.proposals to authenticated`);
  await db.exec(`grant execute on function public.recompute_proposal_pricing() to public`);
  const { rows } = await db.query<{ n: number; ok: boolean }>(readScript('0055_travel_kinds_verify.sql'));
  const failed = rows.filter((r) => !r.ok).map((r) => r.n);
  assert(failed.includes(21) && failed.includes(23), `fallaron: ${failed}`);
});

// ---------------------------------------------------------------- preflight y rollback exacto
const preflightRows = async (db: PGlite) => (await db.query<PreflightRow>(readScript('0055_travel_kinds_preflight.sql'))).rows;

/** Normaliza lo que el rollback restaura «funcionalmente» (ACL implícita = PUBLIC; sin el dueño). */
function normalize(rows: PreflightRow[]): Map<string, string> {
  const keep = new Set(['function.def', 'rls.policies', 'table.constraints', 'table.columns', 'table.triggers', 'table.privileges', 'function.grants', 'table.acl']);
  const map = new Map<string, string>();
  for (const r of rows.filter((x) => keep.has(x.section))) {
    let d = r.detail;
    if (r.section === 'function.grants') {
      d = d.startsWith('sin ACL') ? 'PUBLIC:EXECUTE' : d.split(', ').filter((g) => !g.startsWith('postgres:')).sort().join(', ');
    }
    if (r.section === 'table.acl') {
      d = d.replace(/[{}]/g, '').split(',').filter((e) => /^(anon|authenticated)=/.test(e)).map((e) => e.split('/')[0]).sort().join(',');
    }
    map.set(`${r.section}|${r.item}`, d);
  }
  return map;
}

Deno.test('0055: el preflight es SOLO LECTURA y se ejecuta; devuelve las secciones esperadas', async () => {
  const sql = readScript('0055_travel_kinds_preflight.sql');
  const code = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert(!/\b(create|alter|drop|update|insert|delete|truncate|grant|revoke|do\s*\$\$|call|copy|vacuum|set\s+role|execute)\b/i.test(code.replace(/'[^']*'/g, "''")), 'el preflight solo debe contener un SELECT');
  assertEquals(code.trim().split(';').filter((s) => s.trim()).length, 1, 'una sola sentencia');
  const rows = await preflightRows(await baseline());
  const sections = new Set(rows.map((r) => r.section));
  for (const s of ['table.columns', 'table.constraints', 'table.triggers', 'table.acl', 'rls.policies', 'function.def', 'function.grants', 'fk.to_proposals', 'audit.triggers', 'permissions.helper_defs', 'env.row_counts_by_status']) {
    assert(sections.has(s), `falta la sección ${s}`);
  }
});

Deno.test('0055: el rollback GENERADO desde el preflight restaura EXACTAMENTE el estado previo (funciones, policies, CHECK, privilegios)', async () => {
  const base = await baseline();
  const before = normalize(await preflightRows(base));
  // Con el CSV real de producción, el rollback se genera DESDE ÉL (y el estado previo se construyó con sus mismas definiciones).
  const rollback = buildRollback(PROD ?? (await preflightRows(base)));
  assertStringIncludes(rollback, 'GENERADA por 0055_generate_rollback.ts');

  const db = await baseline();
  await db.exec(read('0055_travel_kinds.sql'));
  const acceptKey = 'function.def|public.accept_proposal(p_token uuid, p_session_token uuid, p_accepted_by_name text)';
  assert(normalize(await preflightRows(db)).get(acceptKey) !== before.get(acceptKey), '0055 sí cambia accept_proposal');
  await db.exec(rollback);
  const after = normalize(await preflightRows(db));

  const diffs: string[] = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    if (before.get(key) !== after.get(key)) diffs.push(`${key}\n  antes: ${before.get(key)?.slice(0, 160)}\n  después: ${after.get(key)?.slice(0, 160)}`);
  }
  assertEquals(diffs, []);

  assertEquals((await db.query(`select * from public.get_proposal_gate('${TOKEN_P}')`)).fields.map((f) => f.name).includes('kind'), false);
  await rejects(() => setStatus(db, P_ONE, 'shared'), 'proposals_status_check');
  const del = (uid: string) => asUser(db, uid, async () => (await db.query(`delete from public.proposals where id = '${P_ONE}' returning id`)).rows.length);
  assertEquals(await del(ADVISOR_A), 0);
  assertEquals(await del(ADMIN), 1);
  await db.exec(read('0055_travel_kinds.sql')); // se puede volver a aplicar
});

Deno.test('0055: el rollback generado se niega si existe un itinerario y no cambia nada', async () => {
  const rollback = buildRollback(await preflightRows(await baseline()));
  const db = await migrated();
  await rejects(() => db.exec(rollback), 'Hay itinerarios');
  await db.exec('rollback').catch(() => {});
  assertEquals((await one<{ n: number }>(db, `select count(*)::int n from public.proposals where kind = 'itinerary'`)).n, 2);
  assertEquals((await db.query(`select 1 from information_schema.columns where table_name = 'proposals' and column_name in ('kind', 'shared_at')`)).rows.length, 2);
});

Deno.test('0055: el generador exige un preflight completo y lee CSV y JSON', async () => {
  const rows = await preflightRows(await baseline());
  assertEquals(buildRollback(rows).includes('begin;'), true);
  let threw = false;
  try {
    buildRollback(rows.filter((r) => r.section !== 'function.def'));
  } catch (e) {
    threw = (e as Error).message.includes('no tiene todo lo necesario');
  }
  assert(threw);
  // Igual que el export real del SQL Editor: cada barra invertida sale duplicada.
  const csv = ['section,item,detail', ...rows.map((r) => [r.section, r.item, r.detail].map((v) => `"${String(v).replaceAll('\\', '\\\\').replaceAll('"', '""')}"`).join(','))].join('\n');
  assertEquals(loadPreflight(csv).length, rows.length);
  assertEquals(buildRollback(loadPreflight(csv)), buildRollback(rows));
  assertEquals(buildRollback(loadPreflight(JSON.stringify(rows))), buildRollback(rows));
});

Deno.test('0055: el rollback del repo es el marcador que se niega a ejecutarse, o el generado', async () => {
  const text = readScript('0055_travel_kinds_rollback.sql');
  if (text.includes('NO GENERADO TODAVÍA')) {
    await assertRejects(() => (baseline().then((db) => db.exec(text))), Error, 'Rollback de 0055 no generado');
  } else {
    assertStringIncludes(text, 'GENERADA por 0055_generate_rollback.ts');
  }
});

Deno.test('0055: solo el SQL principal está en supabase/migrations; verify, rollback, preflight y generador en migration-scripts', () => {
  const inMigrations = [...Deno.readDirSync(new URL('../../migrations/', import.meta.url))].map((e) => e.name).filter((n) => n.startsWith('0055_'));
  assertEquals(inMigrations, ['0055_travel_kinds.sql']);
  // El CSV del preflight real NO se versiona (está en .gitignore): si existe en esta copia, no cuenta.
  const inScripts = [...Deno.readDirSync(new URL('../../migration-scripts/', import.meta.url))].map((e) => e.name)
    .filter((n) => n.startsWith('0055_') && !n.endsWith('_preflight_production.csv')).sort();
  assertEquals(inScripts, ['0055_generate_rollback.ts', '0055_travel_kinds_preflight.sql', '0055_travel_kinds_rollback.sql', '0055_travel_kinds_verify.sql']);
  assertStringIncludes(read('0055_travel_kinds.sql'), 'supabase db query --linked -f supabase/migrations/0055_travel_kinds.sql');
});

// ACL REAL de producción de las funciones de auditoría: {postgres=X/postgres,service_role=X/postgres}.
const LOG_FNS = ['log_proposal_created()', 'log_proposal_deleted()', 'log_proposal_status_change()'];
async function logAcl(db: PGlite): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const fn of LOG_FNS) {
    out[fn] = (await one<{ p: string }>(db, `select coalesce(proacl::text, 'NULL') p from pg_proc where oid = 'public.${fn}'::regprocedure`)).p;
    for (const role of ['public', 'anon', 'authenticated']) {
      const r = await one<{ ok: boolean }>(db, `select has_function_privilege('${role === 'public' ? 'public' : role}', 'public.${fn}', 'EXECUTE') ok`);
      assertEquals(r.ok, false, `${role} no debe poder ejecutar ${fn}`);
    }
    assertEquals((await one<{ ok: boolean }>(db, `select has_function_privilege('service_role', 'public.${fn}', 'EXECUTE') ok`)).ok, true);
  }
  return out;
}

Deno.test('0055: ACL de log_proposal_* — igual antes, después de 0055 y después del rollback (sin PUBLIC/anon/authenticated)', async () => {
  const db = await baseline();
  const before = await logAcl(db);
  for (const acl of Object.values(before)) assertStringIncludes(acl, 'service_role=X/');
  await db.exec(read('0055_travel_kinds.sql'));
  assertEquals(await logAcl(db), before);
  await db.exec(buildRollback(PROD ?? (await preflightRows(await baseline()))));
  assertEquals(await logAcl(db), before);
  // El rollback generado las restaura explícitamente (no depende de que CREATE OR REPLACE conserve la ACL).
  const rb = buildRollback(PROD ?? (await preflightRows(await baseline())));
  for (const fn of LOG_FNS) assertStringIncludes(rb, `revoke all on function public.${fn} from public, anon, authenticated;`);
});

Deno.test('0055: el verify FALLA si una log_proposal_* queda ejecutable por authenticated o PUBLIC', async () => {
  for (const grant of ['authenticated', 'public']) {
    const db = await baseline();
    await db.exec(read('0055_travel_kinds.sql'));
    await db.exec(`grant execute on function public.log_proposal_deleted() to ${grant}`);
    const { rows } = await db.query<{ n: number; ok: boolean }>(readScript('0055_travel_kinds_verify.sql'));
    assertEquals(rows.filter((r) => !r.ok).map((r) => r.n).includes(28), true, grant);
  }
});
