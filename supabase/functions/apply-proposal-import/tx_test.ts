// Prueba de la transacción REAL (tx.ts) contra una base Postgres en memoria (PGlite), con un esquema
// reducido pero con las mismas restricciones relevantes que producción (check de canal, FK a leads y
// profiles, formato de correo) y un trigger de auditoría que lee auth.uid().
import { PGlite } from 'npm:@electric-sql/pglite@0.3';
import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { applyImportTx, type SqlLike, type TxSql } from './tx.ts';
import { mapExtractionToProposal } from '../_shared/proposal-mapping.ts';
import { postProcessExtraction } from '../_shared/proposal-postprocess.ts';
import { buildRetentionSummary } from '../_shared/import-summary.ts';
import { extraction } from '../_shared/test-fixtures.ts';
import { rawVoucherExtraction } from '../_shared/test-fixtures-voucher.ts';

const USER = '11111111-1111-1111-1111-111111111111';
const LEAD = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
const IMPORT = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

// Valor marcado por `sql.json(...)`, igual que en postgres.js.
class JsonParam {
  constructor(readonly value: unknown) {}
}

// Adaptador: la plantilla de postgres.js ($1, $2…) sobre PGlite. Reproduce cómo postgres.js serializa los parámetros
// que el servidor tipa como jsonb: SIEMPRE con JSON.stringify. Por eso un string que ya es JSON y va a un `$n::jsonb`
// se guarda como string JSON (doble codificación), y `sql.json(obj)` guarda el objeto. PGlite por sí solo aceptaría
// el string tal cual y ocultaría el error.
// deno-lint-ignore no-explicit-any
function adapt(q: { query(text: string, params?: any[]): Promise<{ rows: any[] }> }): TxSql {
  const run: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown[]> = async (strings, ...values) => {
    const text = strings.reduce((acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''), '');
    const params = values.map((v, i) => {
      if (v instanceof JsonParam) {
        return JSON.stringify(v.value);
      }
      return typeof v === 'string' && /^\s*::jsonb/.test(strings[i + 1] ?? '') ? JSON.stringify(v) : v;
    });
    return (await q.query(text, params)).rows;
  };
  return Object.assign(run, { json: (value: unknown) => new JsonParam(value) }) as unknown as TxSql;
}

async function setup(): Promise<{ db: PGlite; sql: SqlLike }> {
  const db = new PGlite();
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                             (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid $$;
    create table public.profiles (id uuid primary key);
    create table public.leads (id uuid primary key);
    create table public.proposals (
      id uuid primary key default gen_random_uuid(),
      -- Como 0055: la columna existe con DEFAULT 'proposal', y el CHECK la limita a los dos tipos.
      kind text not null default 'proposal' check (kind in ('proposal', 'itinerary')),
      status text not null default 'draft',
      client_name text not null,
      client_email text check (client_email is null or client_email ~* '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$'),
      client_phone text, destination_text text, start_date date, end_date date, travelers_count int,
      currency text not null default 'USD',
      advisor_id uuid references profiles(id), created_by uuid references profiles(id),
      origin_channel text not null default 'other' check (origin_channel in ('web','whatsapp','email','phone','referral','other')),
      lead_id uuid references leads(id),
      content jsonb not null default '{}');
    create table public.proposal_imports (
      id uuid primary key default gen_random_uuid(),
      proposal_id uuid references proposals(id) on delete set null,
      file_path text not null, mode text not null, status text not null,
      extracted jsonb, diff jsonb, applied_at timestamptz, created_by uuid references profiles(id));
    create table public.audit (actor uuid, entity uuid);
    create function public.log_created() returns trigger language plpgsql as $$
      begin insert into public.audit values (auth.uid(), new.id); return new; end $$;
    create trigger trg_log_created after insert on public.proposals for each row execute function public.log_created();
    insert into profiles values ('${USER}');
    insert into leads values ('${LEAD}');
    insert into proposal_imports (id, file_path, mode, status, created_by)
      values ('${IMPORT}', '${USER}/x.pdf', 'new', 'ready', '${USER}');
  `);
  await db.query(`update proposal_imports set extracted = $1::jsonb`, [JSON.stringify(FULL)]);
  const sql = Object.assign(adapt(db), {
    begin: <T>(fn: (tx: TxSql) => Promise<T>) => db.transaction((tx) => fn(adapt(tx)))
  }) as SqlLike;
  return { db, sql };
}

const mapped = () => mapExtractionToProposal(postProcessExtraction(rawVoucherExtraction()).extraction);

/** Lo que hay en proposal_imports.extracted al terminar la extracción (con datos personales): extracción + avisos + meta. */
const USAGE = { calls: 1, inputTokens: 1200, outputTokens: 800, reasoningTokens: 100, costUsd: 0.0104, totalMs: 4200 };
const FULL = {
  ...postProcessExtraction(rawVoucherExtraction()).extraction,
  warnings: [{ code: 'days_merged', message: 'Se unieron 1 día repetido.' }],
  meta: { model: 'gpt-6.1-sol', extracted_at: '2027-01-01T00:00:00Z', usage: USAGE }
};
const retained = () => buildRetentionSummary(postProcessExtraction(rawVoucherExtraction()).extraction, FULL);
const importRow = async (db: PGlite, id = IMPORT) =>
  (await db.query<{ status: string; applied_at: string | null; proposal_id: string | null }>(`select status, applied_at, proposal_id from proposal_imports where id = $1`, [id])).rows[0];
const count = async (db: PGlite, table: string) => (await db.query<{ n: number }>(`select count(*)::int n from ${table}`)).rows[0].n;

Deno.test('tx: crea la propuesta en borrador, marca la importación como aplicada y las enlaza', async () => {
  const { db, sql } = await setup();
  const m = mapped();
  const proposalId = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'whatsapp', leadId: null, mapped: m, retained: retained() });
  assert(proposalId !== 'conflict');

  const imp = await importRow(db);
  assertEquals(imp.status, 'applied');
  assert(imp.applied_at !== null);
  assertEquals(imp.proposal_id, proposalId);

  const p = (await db.query<Record<string, unknown>>(`select * from proposals where id = $1`, [proposalId])).rows[0];
  assertEquals(p.status, 'draft');
  assertEquals(p.advisor_id, USER);
  assertEquals(p.created_by, USER);
  assertEquals(p.origin_channel, 'whatsapp');
  assertEquals(p.lead_id, null);
  assertEquals(p.client_name, 'Persona Ejemplo');
  assertEquals(p.currency, 'USD');
  assertEquals(p.travelers_count, 2);
  assertEquals(p.content, JSON.parse(JSON.stringify(m.content))); // el contenido llega íntegro
});

Deno.test('tx: dentro de la transacción auth.uid() es la asesora (la auditoría la ve como autora)', async () => {
  const { db, sql } = await setup();
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'email', leadId: null, mapped: mapped(), retained: retained() });
  const audit = (await db.query<{ actor: string; entity: string }>(`select actor, entity from audit`)).rows;
  assertEquals(audit, [{ actor: USER, entity: id }]);
});

Deno.test('tx: con lead vinculado se guarda lead_id', async () => {
  const { db, sql } = await setup();
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: LEAD, mapped: mapped(), retained: retained() });
  const p = (await db.query<{ lead_id: string; origin_channel: string }>(`select lead_id, origin_channel from proposals where id = $1`, [id])).rows[0];
  assertEquals(p, { lead_id: LEAD, origin_channel: 'web' });
});

Deno.test('tx: doble aplicación → la segunda devuelve conflict y no crea otra propuesta', async () => {
  const { db, sql } = await setup();
  const args = { importId: IMPORT, userId: USER, originChannel: 'web' as const, leadId: null, mapped: mapped(), retained: retained() };
  assert((await applyImportTx(sql, args)) !== 'conflict');
  assertEquals(await applyImportTx(sql, args), 'conflict');
  assertEquals(await count(db, 'proposals'), 1);
  assertEquals((await importRow(db)).status, 'applied');
});

Deno.test('tx: una importación en merge o que no está en ready → conflict sin tocar nada', async () => {
  const { db, sql } = await setup();
  for (const [mode, status] of [['merge', 'ready'], ['new', 'processing'], ['new', 'failed']]) {
    await db.query(`update proposal_imports set mode = $1, status = $2, applied_at = null, proposal_id = null`, [mode, status]);
    assertEquals(await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: null, mapped: mapped(), retained: retained() }), 'conflict', `${mode}/${status}`);
    assertEquals(await count(db, 'proposals'), 0);
  }
});

Deno.test('tx: si falla el insert (canal inválido) TODO se revierte: la importación sigue en ready', async () => {
  const { db, sql } = await setup();
  await assertRejects(() =>
    applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'telegram' as never, leadId: null, mapped: mapped(), retained: retained() })
  );
  const imp = await importRow(db);
  assertEquals(imp, { status: 'ready', applied_at: null, proposal_id: null });
  assertEquals(await count(db, 'proposals'), 0);
  assertEquals(await count(db, 'audit'), 0);
});

Deno.test('tx: si falla por una FK (lead inexistente) también se revierte todo', async () => {
  const { db, sql } = await setup();
  await assertRejects(() =>
    applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: '99999999-9999-9999-9999-999999999999', mapped: mapped(), retained: retained() })
  );
  assertEquals((await importRow(db)).status, 'ready');
  assertEquals(await count(db, 'proposals'), 0);
});

Deno.test('tx: tras un fallo se puede reintentar con datos correctos', async () => {
  const { db, sql } = await setup();
  await assertRejects(() => applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'telegram' as never, leadId: null, mapped: mapped(), retained: retained() }));
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: null, mapped: mapped(), retained: retained() });
  assert(id !== 'conflict');
  assertEquals((await importRow(db)).status, 'applied');
});

Deno.test('tx: el texto del PDF va como parámetro — comillas y SQL en el nombre no se interpretan', async () => {
  const { db, sql } = await setup();
  const evil = "Robert'); drop table proposals;--";
  const m = mapExtractionToProposal(postProcessExtraction(extraction({ client: { name: evil, email: null, phone: null }, days: [{ number: 1, date: null, base_city: evil, title: null, summary: evil, services: [] }] })).extraction);
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'other', leadId: null, mapped: m, retained: retained() });
  const row = (await db.query<{ client_name: string; content: { days: { title: string }[] } }>(`select client_name, content from proposals where id = $1`, [id])).rows[0];
  assertEquals(row.client_name, evil);
  assertEquals(row.content.days[0].title, evil);
  assertEquals(await count(db, 'proposals'), 1); // la tabla sigue ahí
});

Deno.test('tx: pricing null y datos faltantes se guardan vacíos (cliente sin nombre, sin fechas)', async () => {
  const { db, sql } = await setup();
  const m = mapExtractionToProposal(extraction());
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'other', leadId: null, mapped: m, retained: retained() });
  const row = (await db.query<Record<string, unknown>>(`select client_name, start_date, travelers_count, currency, content from proposals where id = $1`, [id])).rows[0];
  assertEquals([row.client_name, row.start_date, row.travelers_count, row.currency], ['', null, null, 'USD']);
});

const extractedOf = async (db: PGlite) =>
  (await db.query<{ extracted: Record<string, unknown> | null; diff: unknown; text: string }>(
    `select extracted, diff, extracted::text as text from proposal_imports where id = $1`, [IMPORT]
  )).rows[0];

Deno.test('tx: al aplicar, extracted pasa a ser un resumen SIN datos personales y diff queda en null', async () => {
  const { db, sql } = await setup();
  assert((await extractedOf(db)).text.includes('Persona Ejemplo')); // antes: la extracción completa
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'whatsapp', leadId: null, mapped: mapped(), retained: retained() });
  assert(id !== 'conflict');

  const row = await extractedOf(db);
  assertEquals(row.extracted, JSON.parse(JSON.stringify(retained())));
  assertEquals(row.diff, null);
  for (const secret of ['Persona Ejemplo', 'persona@ejemplo.test', '+5491155550000', 'Hotel Faro', 'Isla Central', 'Paquete']) {
    assert(!row.text.includes(secret), 'no debe quedar ' + secret);
  }
  // extracted.meta.usage se conserva tal cual.
  assertEquals((row.extracted as { meta: { usage: unknown } }).meta.usage, USAGE);
  assertEquals((row.extracted as { redacted: boolean }).redacted, true);
  // …y los datos sí están en la propuesta creada.
  const p = (await db.query<{ client_name: string }>(`select client_name from proposals where id = $1`, [id])).rows[0];
  assertEquals(p.client_name, 'Persona Ejemplo');
});

Deno.test('tx: si algo falla, extracted NO se toca (la importación sigue en ready con la extracción completa)', async () => {
  const { db, sql } = await setup();
  await assertRejects(() =>
    applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'telegram' as never, leadId: null, mapped: mapped(), retained: retained() })
  );
  const row = await extractedOf(db);
  assertEquals(row.extracted, JSON.parse(JSON.stringify(FULL)));
  assert(row.text.includes('Persona Ejemplo'));
});

Deno.test('tx: en un conflicto (doble aplicación) el resumen de la primera no se pisa', async () => {
  const { db, sql } = await setup();
  const args = { importId: IMPORT, userId: USER, originChannel: 'web' as const, leadId: null, mapped: mapped(), retained: retained() };
  await applyImportTx(sql, args);
  const first = (await extractedOf(db)).extracted;
  assertEquals(await applyImportTx(sql, { ...args, retained: { ...retained(), meta: { model: 'otro' } } }), 'conflict');
  assertEquals((await extractedOf(db)).extracted, first);
});

Deno.test('tx: content y extracted se guardan como objeto jsonb, no como string JSON (doble codificación)', async () => {
  const { db, sql } = await setup();
  const m = mapped();
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: null, mapped: m, retained: retained() });
  assert(id !== 'conflict');
  const p = (await db.query<{ type: string; days: number; cover_title: string }>(
    `select jsonb_typeof(content) as type, jsonb_array_length(content -> 'days') as days, content -> 'cover' ->> 'title' as cover_title
       from proposals where id = $1`,
    [id]
  )).rows[0];
  assertEquals(p, { type: 'object', days: m.content.days.length, cover_title: m.content.cover.title });
  const imp = (await db.query<{ type: string; redacted: string }>(
    `select jsonb_typeof(extracted) as type, extracted ->> 'redacted' as redacted from proposal_imports where id = $1`,
    [IMPORT]
  )).rows[0];
  assertEquals(imp, { type: 'object', redacted: 'true' });
});

Deno.test('la importación crea SIEMPRE kind=proposal, escrito explícitamente (no depende del DEFAULT)', async () => {
  const { db, sql } = await setup();
  // Si alguien cambiara el DEFAULT de la columna, la importación seguiría creando propuestas.
  await db.exec(`alter table public.proposals alter column kind set default 'itinerary'`);
  const id = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: null, mapped: mapped(), retained: retained() });
  assert(id !== 'conflict');
  const row = (await db.query<{ kind: string }>(`select kind from proposals where id = $1`, [id])).rows[0];
  assertEquals(row.kind, 'proposal');
});

Deno.test('la importación solo INSERTA: un itinerario existente (y una importación merge que lo apunte) queda intacto', async () => {
  const { db, sql } = await setup();
  const ITIN = '77777777-7777-4777-8777-777777777777';
  const MERGE = '88888888-8888-4888-8888-888888888888';
  await db.exec(`insert into proposals (id, kind, client_name, content) values ('${ITIN}', 'itinerary', 'Itinerario', '{"a":1}');
    insert into proposal_imports (id, file_path, mode, status, proposal_id, created_by) values ('${MERGE}', '${USER}/m.pdf', 'merge', 'ready', '${ITIN}', '${USER}')`);
  const before = (await db.query(`select * from proposals where id = '${ITIN}'`)).rows[0];

  assertEquals(await applyImportTx(sql, { importId: MERGE, userId: USER, originChannel: 'web', leadId: null, mapped: mapped(), retained: retained() }), 'conflict');
  const created = await applyImportTx(sql, { importId: IMPORT, userId: USER, originChannel: 'web', leadId: null, mapped: mapped(), retained: retained() });
  assert(created !== 'conflict' && created !== ITIN);

  assertEquals((await db.query(`select * from proposals where id = '${ITIN}'`)).rows[0], before);
  assertEquals((await importRow(db, MERGE)).status, 'ready');
  assertEquals(await count(db, 'proposals'), 2);
});
