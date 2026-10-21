// Prueba de la migración REAL 0055b (más su verify y su rollback) contra Postgres en memoria (PGlite).
// El estado previo replica lo de 0049 (tabla, policy de INSERT con las condiciones reales de producción, grants de columna) y el
// trigger «solo propuestas» de 0055; can_travel es la REAL de 0055 (se extrae del archivo). Los helpers de rol son stubs sobre
// profiles.role (private.app_user_role, can_manage_proposals, is_own_or_full), como en producción.
import { PGlite } from 'npm:@electric-sql/pglite@0.3';
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1';

const read = (dir: string, name: string) => Deno.readTextFileSync(new URL(`../../${dir}/${name}`, import.meta.url));
const migration = () => read('migrations', '0055b_proposal_imports_kind.sql');
const verify = () => read('migration-scripts', '0055b_proposal_imports_kind_verify.sql');
const rollback = () => read('migration-scripts', '0055b_proposal_imports_kind_rollback.sql');

const ADMIN = '99999999-9999-4999-8999-99999999000c';
const EDITOR = '99999999-9999-4999-8999-99999999000d';
const STAFF = '99999999-9999-4999-8999-99999999000a';
const NOBODY = '99999999-9999-4999-8999-0000000000ff';
const P_PROPOSAL = '11111111-1111-4111-8111-111111111111';
const P_ITINERARY = '22222222-2222-4222-8222-222222222222';
const uuid = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const path = (uid: string, n: number) => `${uid}/${uuid(n)}.pdf`;

/** La función REAL can_travel de 0055 (de «create or replace function public.can_travel» a su «$$;»). */
function realCanTravel(): string {
  const text = read('migrations', '0055_travel_kinds.sql');
  const start = text.indexOf('create or replace function public.can_travel');
  const end = text.indexOf('\n$$;', start) + 4;
  return text.slice(start, end);
}

async function baseline(): Promise<PGlite> {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema private; create schema auth;
    grant usage on schema public, private, auth to anon, authenticated, service_role;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
    create table public.profiles (id uuid primary key, role text);
    insert into public.profiles values ('${ADMIN}', 'admin'), ('${EDITOR}', 'editor'), ('${STAFF}', 'staff'), ('${NOBODY}', null);
    grant select on public.profiles to authenticated;
    create function private.app_user_role() returns text language sql stable security definer set search_path = '' as
      $$ select role from public.profiles where id = auth.uid() $$;
    grant execute on function private.app_user_role() to authenticated;
    create function public.can_manage_proposals() returns boolean language sql stable set search_path = '' as
      $$ select private.app_user_role() in ('admin', 'editor', 'staff') $$;
    create function public.is_own_or_full(p_owner uuid) returns boolean language sql stable set search_path = '' as
      $$ select private.app_user_role() in ('admin', 'editor') or (private.app_user_role() = 'staff' and p_owner = auth.uid()) $$;
    grant execute on function public.can_manage_proposals(), public.is_own_or_full(uuid) to authenticated;

    create table public.proposals (
      id uuid primary key default gen_random_uuid(),
      kind text not null default 'proposal' check (kind in ('proposal', 'itinerary')),
      client_name text not null default 'x', advisor_id uuid);
    insert into public.proposals (id, kind, advisor_id) values ('${P_PROPOSAL}', 'proposal', '${STAFF}'), ('${P_ITINERARY}', 'itinerary', '${STAFF}');
    grant select on public.proposals to authenticated;

    ${realCanTravel()}

    create table public.proposal_imports (
      id uuid primary key default gen_random_uuid(),
      proposal_id uuid references public.proposals(id) on delete set null,
      file_path text not null,
      mode text not null check (mode in ('new', 'merge')),
      status text not null default 'uploaded' check (status in ('uploaded', 'processing', 'ready', 'applied', 'failed')),
      extracted jsonb, diff jsonb, error text,
      created_by uuid not null references public.profiles(id),
      created_at timestamptz not null default now(),
      applied_at timestamptz,
      constraint proposal_imports_merge_needs_proposal check (mode = 'new' or proposal_id is not null));
    alter table public.proposal_imports enable row level security;
    create policy proposal_imports_select on public.proposal_imports for select
      using (public.can_manage_proposals() and public.is_own_or_full(created_by));
    create policy proposal_imports_insert on public.proposal_imports for insert
      with check (
        public.can_manage_proposals() and created_by = auth.uid() and status = 'uploaded'
        and extracted is null and diff is null and error is null and applied_at is null
        and (proposal_id is null or exists (select 1 from public.proposals p where p.id = proposal_id and public.is_own_or_full(p.advisor_id)))
        and file_path ~ ('^' || auth.uid()::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.pdf$'));
    revoke all on public.proposal_imports from anon, authenticated;
    grant select on public.proposal_imports to authenticated;
    grant insert (proposal_id, file_path, mode, created_by) on public.proposal_imports to authenticated;

    -- Trigger de 0055 (solo propuestas).
    create function public.enforce_import_targets_proposal() returns trigger language plpgsql set search_path = '' as $$
    begin
      if new.proposal_id is not null
         and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.kind = 'proposal') then
        raise exception 'import_requires_proposal: la importación de PDF solo aplica a propuestas';
      end if;
      return new;
    end; $$;
    create trigger trg_proposal_imports_only_proposals before insert or update of proposal_id on public.proposal_imports
      for each row execute function public.enforce_import_targets_proposal();
    revoke execute on function public.enforce_import_targets_proposal() from public, anon, authenticated;

    -- Una importación previa a 0055b (sin columna kind todavía).
    insert into public.proposal_imports (id, file_path, mode, created_by) values ('${uuid(900)}', '${path(STAFF, 900)}', 'new', '${STAFF}');
  `);
  return db;
}

async function migrated(): Promise<PGlite> {
  const db = await baseline();
  await db.exec(migration());
  return db;
}

async function asUser<T>(db: PGlite, uid: string, fn: () => Promise<T>): Promise<T> {
  await db.exec(`set app.uid = '${uid}'; set role authenticated`);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role; reset app.uid`);
  }
}

const rejects = (fn: () => Promise<unknown>, fragment: string) => assertRejects(fn, Error, fragment);
const insertImport = (db: PGlite, uid: string, n: number, kind: string | null, mode = 'new') =>
  db.exec(`insert into public.proposal_imports (file_path, mode, created_by${kind ? ', kind' : ''}) values ('${path(uid, n)}', '${mode}', '${uid}'${kind ? `, '${kind}'` : ''})`);

Deno.test('0055b: se aplica, las importaciones existentes quedan como proposal y el verify da ok en todas las filas', async () => {
  const db = await migrated();
  assertEquals((await db.query<{ kind: string }>(`select kind from public.proposal_imports where id = '${uuid(900)}'`)).rows[0].kind, 'proposal');
  const { rows } = await db.query<{ n: number; check: string; ok: boolean }>(verify());
  assertEquals(rows.length, 9);
  assertEquals(rows.filter((r) => !r.ok).map((r) => `${r.n} ${r.check}`), []);
});

Deno.test('0055b: se puede volver a aplicar sobre el estado previo tras el rollback', async () => {
  const db = await migrated();
  await db.exec(rollback());
  await db.exec(migration());
  assertEquals((await db.query<{ ok: boolean }>(verify())).rows.every((r) => r.ok), true);
});

Deno.test('0055b: admin, editor y staff pueden subir una importación de proposal o de itinerary (mode new)', async () => {
  const db = await migrated();
  let n = 1;
  for (const uid of [ADMIN, EDITOR, STAFF]) {
    for (const kind of ['proposal', 'itinerary']) {
      await asUser(db, uid, () => insertImport(db, uid, n++, kind));
    }
  }
  assertEquals((await db.query(`select 1 from public.proposal_imports where kind = 'itinerary'`)).rows.length, 3);
});

Deno.test('0055b: sin kind la fila nace proposal (DEFAULT) — el frontend lo envía siempre explícito', async () => {
  const db = await migrated();
  await asUser(db, STAFF, () => insertImport(db, STAFF, 1, null));
  assertEquals((await db.query<{ kind: string }>(`select kind from public.proposal_imports where file_path = '${path(STAFF, 1)}'`)).rows[0].kind, 'proposal');
});

Deno.test('0055b: un kind inválido, o un usuario sin permiso de crear, se rechaza', async () => {
  const db = await migrated();
  await asUser(db, STAFF, async () => {
    // Un tipo desconocido ya lo corta la policy (can_travel es false); el CHECK es la segunda barrera, incluso para service_role.
    await rejects(() => insertImport(db, STAFF, 1, 'trip'), 'row-level security');
  });
  await rejects(() => insertImport(db, STAFF, 5, 'trip'), 'proposal_imports_kind_check');
  await asUser(db, NOBODY, async () => {
    await rejects(() => insertImport(db, NOBODY, 2, 'itinerary'), 'row-level security');
    await rejects(() => insertImport(db, NOBODY, 3, 'proposal'), 'row-level security');
  });
  // Y nadie sube a nombre de otro.
  await asUser(db, STAFF, async () => {
    await rejects(() => db.exec(`insert into public.proposal_imports (file_path, mode, created_by, kind) values ('${path(ADMIN, 4)}', 'new', '${ADMIN}', 'itinerary')`), 'row-level security');
  });
});

Deno.test('0055b: la policy exige can_travel(kind, crear): si la base lo niega para itinerary, solo se bloquea ese tipo', async () => {
  const db = await migrated();
  // Se redefine can_travel como la devolvería una futura tabla de permisos sin itinerarios.crear.
  await db.exec(`create or replace function public.can_travel(p_kind text, p_action text) returns boolean language sql stable set search_path = ''
    as $$ select p_kind = 'proposal' and private.app_user_role() is not null $$`);
  await asUser(db, ADMIN, async () => {
    await insertImport(db, ADMIN, 1, 'proposal');
    await rejects(() => insertImport(db, ADMIN, 2, 'itinerary'), 'row-level security');
  });
});

Deno.test('0055b: un itinerario solo se importa como nuevo (merge → CHECK)', async () => {
  const db = await migrated();
  await asUser(db, ADMIN, async () => {
    await rejects(
      () => db.exec(`insert into public.proposal_imports (file_path, mode, created_by, kind, proposal_id) values ('${path(ADMIN, 1)}', 'merge', '${ADMIN}', 'itinerary', '${P_ITINERARY}')`),
      'proposal_imports_itinerary_new_only'
    );
    // Una importación de propuesta en merge sigue funcionando (sobre una propuesta).
    await db.exec(`insert into public.proposal_imports (file_path, mode, created_by, kind, proposal_id) values ('${path(ADMIN, 2)}', 'merge', '${ADMIN}', 'proposal', '${P_PROPOSAL}')`);
  });
});

Deno.test('0055b: authenticated NO puede cambiar el kind (sin UPDATE) y ni siquiera service_role: el trigger lo impide', async () => {
  const db = await migrated();
  await asUser(db, STAFF, async () => {
    await insertImport(db, STAFF, 1, 'itinerary');
    await rejects(() => db.exec(`update public.proposal_imports set kind = 'proposal' where file_path = '${path(STAFF, 1)}'`), 'permission denied');
  });
  await rejects(() => db.exec(`update public.proposal_imports set kind = 'proposal' where file_path = '${path(STAFF, 1)}'`), 'import_kind_immutable');
  // Actualizar otras columnas (lo que hace el servicio al procesar) sigue permitido.
  await db.exec(`update public.proposal_imports set status = 'processing' where file_path = '${path(STAFF, 1)}'`);
});

Deno.test('0055b: una importación solo se enlaza a un registro de SU tipo (propuesta↔propuesta, itinerario↔itinerario)', async () => {
  const db = await migrated();
  await asUser(db, STAFF, async () => {
    await insertImport(db, STAFF, 1, 'itinerary');
    await insertImport(db, STAFF, 2, 'proposal');
  });
  const link = (n: number, id: string) => db.exec(`update public.proposal_imports set proposal_id = '${id}' where file_path = '${path(STAFF, n)}'`);
  // Cruzado: rechazado en la base, tal como pide el guard.
  await rejects(() => link(1, P_PROPOSAL), 'import_kind_mismatch');
  await rejects(() => link(2, P_ITINERARY), 'import_kind_mismatch');
  // Mismo tipo: permitido.
  await link(1, P_ITINERARY);
  await link(2, P_PROPOSAL);
  assertEquals((await db.query(`select 1 from public.proposal_imports where proposal_id is not null`)).rows.length, 2);
});

Deno.test('0055b: las funciones de trigger no son ejecutables por authenticated ni anon', async () => {
  const db = await migrated();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const fn of ['enforce_import_kind_match', 'enforce_import_kind_immutable']) {
      await assertRejects(() => db.exec(`select public.${fn}()`), Error, 'permission denied');
    }
    await db.exec('reset role');
  }
});

Deno.test('0055b: el rollback restaura el estado de 0055 (solo propuestas) y borra la columna', async () => {
  const db = await migrated();
  await db.exec(rollback());
  assertEquals((await db.query(`select 1 from information_schema.columns where table_name = 'proposal_imports' and column_name = 'kind'`)).rows.length, 0);
  assertEquals((await db.query(`select 1 from pg_trigger where tgname = 'trg_proposal_imports_only_proposals'`)).rows.length, 1);
  assertEquals((await db.query(`select 1 from pg_trigger where tgname in ('trg_proposal_imports_same_kind', 'trg_proposal_imports_kind_immutable')`)).rows.length, 0);
  const policy = (await db.query<{ with_check: string }>(`select with_check from pg_policies where tablename = 'proposal_imports' and policyname = 'proposal_imports_insert'`)).rows[0];
  assert(!policy.with_check.includes('can_travel'));
  // El trigger de 0055 vuelve a rechazar enlazar un itinerario.
  await asUser(db, STAFF, () => db.exec(`insert into public.proposal_imports (file_path, mode, created_by) values ('${path(STAFF, 1)}', 'new', '${STAFF}')`));
  await rejects(() => db.exec(`update public.proposal_imports set proposal_id = '${P_ITINERARY}' where file_path = '${path(STAFF, 1)}'`), 'import_requires_proposal');
});

Deno.test('0055b: el rollback se niega si existe una importación de itinerario y no cambia nada', async () => {
  const db = await migrated();
  await asUser(db, STAFF, () => insertImport(db, STAFF, 1, 'itinerary'));
  await rejects(() => db.exec(rollback()), 'Hay importaciones de itinerario');
  await db.exec('rollback').catch(() => {});
  assertEquals((await db.query(`select 1 from information_schema.columns where table_name = 'proposal_imports' and column_name = 'kind'`)).rows.length, 1);
});

Deno.test('0055b: la migración solo toca proposal_imports (no proposals ni sus policies) y no cambia secrets/funciones de Edge', () => {
  const sql = migration().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert(!/\balter\s+table\s+public\.proposals\b/i.test(sql));
  assert(!/\bpolicy\b[^;]*\bon\s+public\.proposals\b/i.test(sql));
  assertStringIncludes(migration(), 'supabase db query --linked -f supabase/migrations/0055b_proposal_imports_kind.sql');
});

// ---------------------------------------------------------------- preflight final de 0055b

Deno.test('0055b: TODAS las filas legacy quedan con kind = proposal, y la columna es NOT NULL con CHECK (también para filas en cualquier estado)', async () => {
  const db = await baseline();
  // Filas legacy en cada estado, creadas ANTES de 0055b.
  let n = 800;
  for (const status of ['uploaded', 'processing', 'ready', 'applied', 'failed']) {
    await db.exec(`insert into public.proposal_imports (file_path, mode, status, created_by) values ('${path(STAFF, n++)}', 'new', '${status}', '${STAFF}')`);
  }
  await db.exec(`insert into public.proposal_imports (file_path, mode, created_by, proposal_id) values ('${path(STAFF, n++)}', 'merge', '${STAFF}', '${P_PROPOSAL}')`);
  const total = (await db.query<{ n: number }>(`select count(*)::int n from public.proposal_imports`)).rows[0].n;
  await db.exec(migration());
  const kinds = (await db.query<{ kind: string; n: number }>(`select kind, count(*)::int n from public.proposal_imports group by kind`)).rows;
  assertEquals(kinds, [{ kind: 'proposal', n: total }]);
  const col = (await db.query<{ is_nullable: string; data_type: string }>(
    `select is_nullable, data_type from information_schema.columns where table_name = 'proposal_imports' and column_name = 'kind'`
  )).rows[0];
  assertEquals([col.is_nullable, col.data_type], ['NO', 'text']);
  // NULL: el INSERT lo rechaza la columna NOT NULL; el UPDATE, el trigger de inmutabilidad.
  await assertRejects(() => db.exec(`insert into public.proposal_imports (file_path, mode, created_by, kind) values ('${path(STAFF, 1)}', 'new', '${STAFF}', null)`), Error, 'null value');
  await assertRejects(() => db.exec(`update public.proposal_imports set kind = null`), Error, 'import_kind_immutable');
  const check = (await db.query<{ def: string }>(`select pg_get_constraintdef(oid) def from pg_constraint where conname = 'proposal_imports_kind_check'`)).rows[0].def;
  assertStringIncludes(check, "'proposal'");
  assertStringIncludes(check, "'itinerary'");
});

Deno.test('0055b: una propuesta sigue siendo compatible con las importaciones existentes (merge sobre una propuesta, new, enlazar al aplicar)', async () => {
  const db = await migrated();
  await asUser(db, STAFF, async () => {
    await db.exec(`insert into public.proposal_imports (file_path, mode, created_by, kind, proposal_id) values ('${path(STAFF, 1)}', 'merge', '${STAFF}', 'proposal', '${P_PROPOSAL}')`);
    await insertImport(db, STAFF, 2, 'proposal');
  });
  await db.exec(`update public.proposal_imports set status = 'applied', proposal_id = '${P_PROPOSAL}' where file_path = '${path(STAFF, 2)}'`);
  assertEquals((await db.query(`select 1 from public.proposal_imports where kind = 'proposal' and proposal_id = '${P_PROPOSAL}'`)).rows.length, 2);
  assertEquals((await db.query<{ ok: boolean }>(verify())).rows.every((r) => r.ok), true);
});

Deno.test('0055b: el rollback se niega con una importación de itinerario en CUALQUIER estado (y no toca nada)', async () => {
  for (const status of ['uploaded', 'processing', 'ready', 'applied', 'failed']) {
    const db = await migrated();
    await asUser(db, STAFF, () => insertImport(db, STAFF, 1, 'itinerary'));
    await db.exec(`update public.proposal_imports set status = '${status}' where file_path = '${path(STAFF, 1)}'`);
    await rejects(() => db.exec(rollback()), 'Hay importaciones de itinerario');
    await db.exec('rollback').catch(() => {});
    assertEquals((await db.query(`select 1 from information_schema.columns where table_name = 'proposal_imports' and column_name = 'kind'`)).rows.length, 1, status);
  }
});

Deno.test('0055b: el rollback con una importación de itinerario ya aplicada (enlazada a su itinerario) también se niega', async () => {
  const db = await migrated();
  await asUser(db, STAFF, () => insertImport(db, STAFF, 1, 'itinerary'));
  await db.exec(`update public.proposal_imports set status = 'applied', proposal_id = '${P_ITINERARY}' where file_path = '${path(STAFF, 1)}'`);
  await rejects(() => db.exec(rollback()), 'Hay importaciones de itinerario');
});

Deno.test('0055b: el verify DETECTA los problemas (kind mutable, enlace cruzado, policy sin permiso por tipo)', async () => {
  const failing = async (tamper: string) => {
    const db = await migrated();
    await db.exec(tamper);
    return (await db.query<{ n: number; ok: boolean }>(verify())).rows.filter((r) => !r.ok).map((r) => r.n);
  };
  assert((await failing(`drop trigger trg_proposal_imports_kind_immutable on public.proposal_imports`)).includes(6));
  assert((await failing(`drop trigger trg_proposal_imports_same_kind on public.proposal_imports`)).includes(6));
  assert((await failing(`drop policy proposal_imports_insert on public.proposal_imports; create policy proposal_imports_insert on public.proposal_imports for insert with check (public.can_manage_proposals())`)).includes(5));
  assert((await failing(`alter table public.proposal_imports drop constraint proposal_imports_kind_check`)).includes(2));
  assert((await failing(`alter table public.proposal_imports drop constraint proposal_imports_itinerary_new_only`)).includes(2));
  assert((await failing(`grant update (kind) on public.proposal_imports to authenticated`)).includes(4));
  // Un enlace cruzado forzado (sin triggers) lo detecta la invariante 8.
  const crossed = await failing(`drop trigger trg_proposal_imports_same_kind on public.proposal_imports;
    insert into public.proposal_imports (file_path, mode, created_by, kind, proposal_id) values ('${path(STAFF, 7)}', 'new', '${STAFF}', 'itinerary', '${P_PROPOSAL}')`);
  assert(crossed.includes(8));
  // Y un legacy que no sea proposal (solo válido justo tras aplicar).
  const legacy = await failing(`insert into public.proposal_imports (file_path, mode, created_by, kind) values ('${path(STAFF, 8)}', 'new', '${STAFF}', 'itinerary')`);
  assert(legacy.includes(3));
});
