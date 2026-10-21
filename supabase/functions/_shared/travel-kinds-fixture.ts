// Punto de partida compartido por las pruebas de las migraciones de Viajes: el estado de producción ANTES de 0055
// (baseline), 0055 aplicada (migrated), y los helpers para actuar como cada rol. Salió de travel_kinds_migration_test.ts
// para que 0056 (y las siguientes) parta del MISMO estado sin duplicarlo ni re-registrar las pruebas de 0055.
import { PGlite } from 'npm:@electric-sql/pglite@0.3';
import { assertRejects } from 'jsr:@std/assert@1';
import { loadPreflight, type PreflightRow } from '../../migration-scripts/0055_generate_rollback.ts';

export const read = (name: string) => Deno.readTextFileSync(new URL(`../../migrations/${name}`, import.meta.url));
export const readScript = (name: string) => Deno.readTextFileSync(new URL(`../../migration-scripts/${name}`, import.meta.url));

/** Preflight REAL de producción (si el CSV está en el repo). Con él, el estado previo de las pruebas usa las definiciones reales. */
export const PROD: PreflightRow[] | null = (() => {
  try {
    return loadPreflight(Deno.readTextFileSync(new URL('../../migration-scripts/0055_travel_kinds_preflight_production.csv', import.meta.url)));
  } catch {
    return null;
  }
})();

/** Desde el inicio de `startPat` hasta el primer `\n$$;` posterior (inclusive). */
export function block(text: string, startPat: RegExp): string {
  const m = startPat.exec(text);
  if (!m) throw new Error(`no encontrado: ${startPat}`);
  const i = text.indexOf('\n$$;', m.index);
  return text.slice(m.index, i + 4);
}

export const P_ONE = '11111111-1111-4111-8111-111111111111'; // propuesta de la asesora A
export const I_ONE = '22222222-2222-4222-8222-222222222222'; // itinerario de la asesora A
export const I_TWO = '33333333-3333-4333-8333-333333333333'; // itinerario de la asesora B
export const TOKEN_P = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const TOKEN_I = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const SESSION_P = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const SESSION_I = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const ADMIN = '99999999-9999-4999-8999-99999999000c';
export const EDITOR = '99999999-9999-4999-8999-99999999000d';
export const ADVISOR_A = '99999999-9999-4999-8999-99999999000a';
export const ADVISOR_B = '99999999-9999-4999-8999-99999999000b';
export const SVC = 'svc-1';

export const CONTENT = JSON.stringify({
  cover: { title: 'Portada', subtitle: '', imagePath: null },
  welcome: { body: 'Hola' },
  days: [{ id: 'd1', services: [{ id: SVC }] }],
  pricing: { lines: [{ id: 'l1', label: 'x', quantity: 1, unitPrice: 100 }], feesLines: [] },
  terms: { title: 'Términos', body: 'Texto' }
});
export const ITINERARY_CONTENT = JSON.stringify({
  cover: { title: 'Portada', subtitle: '', imagePath: null },
  welcome: { body: 'Hola' },
  days: [{ id: 'd1', services: [{ id: SVC }] }],
  pricing: { lines: [], feesLines: [] },
  terms: { title: 'Términos', body: 'Texto' }
});

/** Sustituye las funciones y policies del estado previo por las REALES del preflight de producción. */
export async function applyProduction(db: PGlite, rows: PreflightRow[]): Promise<void> {
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
export async function baseline(): Promise<PGlite> {
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
export async function migrated(): Promise<PGlite> {
  const db = await baseline();
  await db.exec(read('0055_travel_kinds.sql'));
  await db.exec(`
    insert into public.proposals (id, public_token, kind, status, client_name, advisor_id, created_by, content)
      values ('${I_ONE}', '${TOKEN_I}', 'itinerary', 'draft', 'Persona Itinerario', '${ADVISOR_A}', '${ADVISOR_A}', '${ITINERARY_CONTENT}'::jsonb),
             ('${I_TWO}', gen_random_uuid(), 'itinerary', 'draft', 'Otra Persona', '${ADVISOR_B}', '${ADVISOR_B}', '${ITINERARY_CONTENT}'::jsonb);
  `);
  return db;
}

export async function asUser<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec('set role authenticated');
  await db.exec(`select set_config('app.uid', '${uid}', false)`);
  try {
    return await fn();
  } finally {
    await db.exec('reset role');
    await db.exec(`select set_config('app.uid', '', false)`);
  }
}

export const one = async <T>(db: PGlite, sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
export const setStatus = (db: PGlite, id: string, status: string) => db.exec(`update public.proposals set status = '${status}' where id = '${id}'`);
/** Un itinerario compartido/visto exige shared_at (lo escribirá share_itinerary en 0056; aquí se simula como dueño de la base). */
export const share = (db: PGlite, id: string, status = 'shared') =>
  db.exec(`update public.proposals set status = '${status}', shared_at = now() where id = '${id}'`);
export const rejects = (fn: () => Promise<unknown>, msg: string) => assertRejects(fn, Error, msg);
