// Prueba LOCAL de punta a punta del import de PDF por tipo (proposal | itinerary), SIN tocar producción ni ningún secret real.
//
// Es real: el código de las dos Edge Functions (handlers completos, lectura del PDF, extractTrip con su prompt y su validación
// zod, postproceso, sanitización por tipo, mapeo, transacción de apply), el driver postgres.js, las migraciones REALES 0050 y
// 0055b, la función REAL can_travel (0055) y la RLS de proposal_imports.
// Es simulado SOLO lo que exige red o credenciales: la respuesta HTTP de OpenAI (un PDF real necesita una clave y no se usa
// ninguna), Storage y el JWT. La Postgres es PGlite (en memoria, por socket).
//
// Lo que el modelo «devuelve» es una cotización contaminada con todo lo contractual: así se prueba que un itinerario lo descarta
// en el SERVIDOR aunque el modelo lo traiga.
import { PGlite } from 'npm:@electric-sql/pglite@0.5.10';
import { PGLiteSocketServer } from 'npm:@electric-sql/pglite-socket@0.2.13';
import postgres from 'npm:postgres@3';
import { assert, assertEquals, assertFalse, assertStringIncludes } from 'jsr:@std/assert@1';
import { handleRequest as processRequest, type Deps as ProcessDeps, type ImportRow as ProcessRow } from '../import-proposal-pdf/handler.ts';
import { closeImportFailed, closeImportReady, type CloseSql } from '../import-proposal-pdf/import-close.ts';
import { extractTrip, ITINERARY_PROMPT, SYSTEM_PROMPT } from '../import-proposal-pdf/openai.ts';
import { handleRequest as applyRequest, type Deps as ApplyDeps, type ImportRow as ApplyRow } from '../apply-proposal-import/handler.ts';
import { applyImportTx, type SqlLike } from '../apply-proposal-import/tx.ts';
import { matchingExtraction } from './test-fixtures.ts';
import type { Extraction } from './proposal-extraction.ts';
import type { TravelKind } from './travel-kind.ts';

const read = (dir: string, name: string) => Deno.readTextFileSync(new URL(`../../${dir}/${name}`, import.meta.url));

const STAFF = '99999999-9999-4999-8999-99999999000a';
const IMPORT_UUID = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
const filePath = (n: number) => `${STAFF}/${IMPORT_UUID(n)}.pdf`;

/** Un PDF mínimo pero real (cabecera, páginas, EOF): lo valida validatePdf como cualquier archivo subido. */
function buildPdf(): Uint8Array {
  const pages = [1, 2, 3].map((n) => `${n + 2} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>\nendobj\n`).join('');
  return new TextEncoder().encode(`%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 3 >>\nendobj\n${pages}%%EOF\n`);
}

/** Lo que el modelo devolvería para el PDF: viaje operativo + TODO lo contractual que una cotización trae. */
function modelReply(): Extraction {
  const base = matchingExtraction();
  return {
    ...base,
    client: { name: 'Persona Ejemplo', email: 'persona@example.com', phone: null },
    inclusions: ['Todo incluido', 'Traslados privados'],
    exclusions: ['Propinas', 'Vuelos internacionales'],
    notes: ['Lleva abrigo: hace frío por la noche.'],
    missing: ['Precio por persona no encontrado', 'Términos y condiciones'],
    days: base.days.map((d) => ({ ...d, services: d.services.map((s) => ({ ...s, price: { amount: 150, per_person: false } })) }))
  };
}

const openAiReply = (data: unknown) =>
  new Response(
    JSON.stringify({
      status: 'completed',
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(data) }] }],
      usage: { input_tokens: 1200, output_tokens: 800, output_tokens_details: { reasoning_tokens: 100 } }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );

function freePort(): number {
  const listener = Deno.listen({ port: 0, hostname: '127.0.0.1' });
  const { port } = listener.addr as Deno.NetAddr;
  listener.close();
  return port;
}

/** La función REAL can_travel de 0055. */
function realCanTravel(): string {
  const text = read('migrations', '0055_travel_kinds.sql');
  const start = text.indexOf('create or replace function public.can_travel');
  return text.slice(start, text.indexOf('\n$$;', start) + 4);
}

const BASELINE = `
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema private; create schema auth;
  grant usage on schema public, private, auth to anon, authenticated, service_role;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
  create table public.profiles (id uuid primary key, role text);
  insert into public.profiles values ('${STAFF}', 'staff');
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
    status text not null default 'draft',
    client_name text not null, client_email text, client_phone text, destination_text text,
    start_date date, end_date date, travelers_count int,
    currency text not null default 'USD',
    advisor_id uuid, created_by uuid, origin_channel text not null default 'other', lead_id uuid,
    content jsonb not null default '{}',
    pricing_subtotal numeric not null default 0, pricing_fees numeric not null default 0, pricing_total numeric not null default 0,
    terms_accepted boolean not null default false, accepted_at timestamptz, accepted_by_name text,
    service_choices jsonb not null default '{}', service_comments jsonb not null default '{}');
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
  create function public.enforce_import_targets_proposal() returns trigger language plpgsql set search_path = '' as $$
  begin
    if new.proposal_id is not null and not exists (select 1 from public.proposals p where p.id = new.proposal_id and p.kind = 'proposal') then
      raise exception 'import_requires_proposal';
    end if;
    return new;
  end; $$;
  create trigger trg_proposal_imports_only_proposals before insert or update of proposal_id on public.proposal_imports
    for each row execute function public.enforce_import_targets_proposal();
`;

interface Pipeline {
  sql: ReturnType<typeof postgres>;
  openAiCalls: { url: string; body: Record<string, any> }[];
  fetched: string[];
  /** Lo que hace el frontend al subir: INSERT con la sesión de la asesora (RLS). */
  upload(n: number, kind: TravelKind | null): Promise<string>;
  /** import-proposal-pdf completo (handler real) → espera el proceso en segundo plano. */
  process(importId: string): Promise<Response>;
  /** apply-proposal-import completo (handler real, transacción real). */
  apply(importId: string, body?: Record<string, unknown>): Promise<Response>;
  importRow(importId: string): Promise<Record<string, any>>;
  proposals(): Promise<Record<string, any>[]>;
}

async function withPipeline(fn: (p: Pipeline) => Promise<void>): Promise<void> {
  const db = new PGlite();
  await db.exec(BASELINE);
  await db.exec(read('migrations', '0050_proposal_imports_processing_started_at.sql'));
  await db.exec(read('migrations', '0055b_proposal_imports_kind.sql'));
  const port = freePort();
  const server = new PGLiteSocketServer({ db, port, host: '127.0.0.1' });
  await server.start();
  const sql = postgres(`postgres://postgres:postgres@127.0.0.1:${port}/postgres`, { max: 1, prepare: false, idle_timeout: 5 });

  const openAiCalls: Pipeline['openAiCalls'] = [];
  const fetched: string[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    fetched.push(String(url));
    openAiCalls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return Promise.resolve(openAiReply(modelReply()));
  }) as unknown as typeof fetch;
  const tasks: Promise<unknown>[] = [];
  const pdf = buildPdf();

  /** Lecturas con la sesión de la asesora: la RLS decide, como con supabase-js. */
  const asStaff = <T>(work: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> =>
    sql.begin(async (tx) => {
      await tx`select set_config('app.uid', ${STAFF}, true)`;
      await tx.unsafe('set local role authenticated');
      return work(tx);
    }) as Promise<T>;

  const processDeps: ProcessDeps = {
    env: (name) => ({ OPENAI_API_KEY: 'sk-local-no-real-key', OPENAI_MODEL: 'modelo-e2e-local' } as Record<string, string>)[name],
    getUser: (token) => Promise.resolve(token === 'good' ? { id: STAFF } : null),
    getImportAsUser: (_t, id) =>
      asStaff(async (tx) => {
        const rows = await tx`select id, proposal_id, file_path, mode, kind, status, created_by from public.proposal_imports where id = ${id}::uuid`;
        return (rows[0] as unknown as ProcessRow) ?? null;
      }),
    canEditProposal: () => Promise.resolve(true),
    countProcessing: async (userId) => Number((await sql`select private.count_active_proposal_imports(${userId}::uuid) as n`)[0].n),
    countSince: async () => 0,
    lockImport: async (id) => {
      const rows = await sql`
        select r.id, r.proposal_id, r.file_path, r.mode, r.kind, r.status, r.created_by, r.processing_started_at::text as processing_started_at
          from private.claim_proposal_import(${id}::uuid) r`;
      return rows[0]?.id == null ? null : (rows[0] as unknown as ProcessRow);
    },
    objectOwner: () => Promise.resolve({ ownerId: STAFF }),
    download: () => Promise.resolve(pdf),
    getProposalSnapshot: () => Promise.resolve(null),
    // La llamada REAL a extractTrip (prompt por tipo, schema estricto, validación zod); solo la respuesta HTTP está simulada.
    extract: ({ pdfBase64, apiKey, deadlineAt, kind, model, detail, reasoningEffort, maxOutputTokens }) =>
      extractTrip({ apiKey, model, detail, reasoningEffort, maxOutputTokens, deadlineAt, kind, fetchImpl, sleep: () => Promise.resolve() }, pdfBase64),
    finishReady: (row, patch) => closeImportReady(sql as unknown as CloseSql, row, patch),
    finishFailed: (row, message) => closeImportFailed(sql as unknown as CloseSql, row, message),
    runInBackground: (task) => void tasks.push(task),
    now: () => new Date(),
    log: () => {}
  };

  const applyDeps: ApplyDeps = {
    env: () => undefined,
    getUser: (token) => Promise.resolve(token === 'good' ? { id: STAFF } : null),
    getImportAsUser: (_t, id) =>
      asStaff(async (tx) => {
        const rows = await tx`select id, mode, kind, status, file_path, created_by, extracted from public.proposal_imports where id = ${id}::uuid`;
        return (rows[0] as unknown as ApplyRow) ?? null;
      }),
    canTravel: (_t, kind, action) => asStaff(async (tx) => (await tx`select public.can_travel(${kind}, ${action}) as ok`)[0].ok === true),
    canSeeLead: () => Promise.resolve(true),
    applyImport: (args) => applyImportTx(sql as unknown as SqlLike, args),
    deleteFile: () => Promise.resolve(),
    log: () => {}
  };

  const post = (url: string, body: unknown) =>
    new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: 'Bearer good' }, body: JSON.stringify(body) });

  try {
    await fn({
      sql,
      openAiCalls,
      fetched,
      upload: async (n, kind) => {
        const rows = await asStaff(
          (tx) =>
            kind
              ? tx`insert into public.proposal_imports (file_path, mode, kind, created_by) values (${filePath(n)}, 'new', ${kind}, ${STAFF}::uuid) returning id`
              : tx`insert into public.proposal_imports (file_path, mode, created_by) values (${filePath(n)}, 'new', ${STAFF}::uuid) returning id`
        );
        return String(rows[0].id);
      },
      process: async (importId) => {
        const res = await processRequest(post('https://x.test/functions/v1/import-proposal-pdf', { import_id: importId }), processDeps);
        await Promise.all(tasks);
        return res;
      },
      apply: (importId, body = { origin_channel: 'whatsapp' }) =>
        applyRequest(post('https://x.test/functions/v1/apply-proposal-import', { import_id: importId, ...body }), applyDeps),
      importRow: async (importId) => (await sql`select * from public.proposal_imports where id = ${importId}::uuid`)[0] as Record<string, any>,
      proposals: async () => (await sql`select * from public.proposals order by client_name`) as unknown as Record<string, any>[]
    });
  } finally {
    await sql.end({ timeout: 5 });
    await server.stop();
    await db.close();
  }
}

// ---------------------------------------------------------------- ITINERARIO

Deno.test('PDF → itinerario: sube con kind=itinerary, se analiza, y lo contractual se descarta en el servidor', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(1, 'itinerary');
    assertEquals((await p.importRow(id)).kind, 'itinerary');

    const res = await p.process(id);
    assertEquals(res.status, 202);

    // El modelo se llamó UNA vez, con el PDF y el prompt de itinerario (y solo a OpenAI).
    assertEquals(p.openAiCalls.length, 1);
    assertEquals(p.fetched, ['https://api.openai.com/v1/responses']);
    const call = p.openAiCalls[0].body;
    assertStringIncludes(String(call.instructions), ITINERARY_PROMPT);
    assertStringIncludes(JSON.stringify(call.input), 'application/pdf;base64,');

    // El análisis terminó y lo guardado NO trae nada contractual.
    const row = await p.importRow(id);
    assertEquals([row.status, row.error], ['ready', null]);
    const saved = row.extracted as Extraction & { warnings: { code: string }[] };
    assertEquals(saved.pricing, null);
    assertEquals([saved.inclusions, saved.exclusions], [[], []]);
    assert(saved.days.every((d) => d.services.every((s) => s.price === null)));
    assert(saved.days.some((d) => d.services.length > 0), 'el recorrido y los servicios se conservan');
    assertEquals(saved.notes, ['Lleva abrigo: hace frío por la noche.']);
    assertEquals(saved.missing, []);
    for (const code of ['price_total_mismatch', 'pricing_lines_dropped', 'multiple_currencies', 'price_line_without_amount']) {
      assertFalse(saved.warnings.some((w) => w.code === code), code);
    }
    const stored = JSON.stringify(row.extracted);
    for (const secret of ['Todo incluido', 'Propinas', '"amount":150']) {
      assertFalse(stored.includes(secret), secret);
    }
  });
});

Deno.test('PDF → itinerario: al aplicar crea kind=itinerary en borrador, con todo lo comercial en cero y sin moneda propia', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(1, 'itinerary');
    await p.process(id);
    const res = await p.apply(id);
    assertEquals(res.status, 200);
    const { proposal_id } = await res.json();

    const [created] = await p.proposals();
    assertEquals(created.id, proposal_id);
    assertEquals([created.kind, created.status], ['itinerary', 'draft']);
    assertEquals([Number(created.pricing_subtotal), Number(created.pricing_fees), Number(created.pricing_total)], [0, 0, 0]);
    assertEquals([created.terms_accepted, created.accepted_at, created.accepted_by_name], [false, null, null]);
    assertEquals([created.service_choices, created.service_comments], [{}, {}]);
    assertEquals(created.lead_id, null);
    // Sin currency en el INSERT: queda el valor por defecto de la columna, y el builder no la muestra para itinerarios.
    assertEquals(created.currency, 'USD');
    const content = created.content;
    assertEquals(content.pricing, { lines: [], feesLines: [] });
    assertEquals(content.terms, { title: '', body: '' });
    assert(content.days.length > 0 && content.days.some((d: { services: unknown[] }) => d.services.length > 0));
    assertEquals(content.travelTips.flatMap((g: { tips: { body: string }[] }) => g.tips.map((t) => t.body)), ['Lleva abrigo: hace frío por la noche.']);
    for (const day of content.days) {
      for (const service of day.services) {
        assertFalse('price' in service);
      }
    }
    assertFalse(JSON.stringify(content).includes('Todo incluido'));

    // La importación quedó aplicada y enlazada a SU itinerario; lo extraído se reemplazó por un resumen sin precios.
    const row = await p.importRow(id);
    assertEquals([row.status, row.proposal_id, row.kind], ['applied', created.id, 'itinerary']);
    assertEquals(row.extracted.summary.had_pricing, false);
    assertEquals(row.extracted.summary.price_lines, 0);
    // Ninguna otra Edge (publicar, enviar, avisar) participó: solo se habló con OpenAI.
    assertEquals(p.fetched, ['https://api.openai.com/v1/responses']);
  });
});

Deno.test('PDF → itinerario: el tipo no se puede falsificar al aplicar ni con un cuerpo distinto ni cambiando la fila', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(1, 'itinerary');
    await p.process(id);
    const forged = await p.apply(id, { origin_channel: 'web', kind: 'proposal' });
    assertEquals([forged.status, (await forged.json()).code], [409, 'kind_mismatch']);
    assertEquals((await p.proposals()).length, 0);
    assertEquals((await p.importRow(id)).status, 'ready');
    // Ni siquiera con el rol de servicio se puede cambiar el tipo de la importación.
    let blocked = false;
    try {
      await p.sql`update public.proposal_imports set kind = 'proposal' where id = ${id}::uuid`;
    } catch (error) {
      blocked = String((error as Error).message).includes('import_kind_immutable');
    }
    assert(blocked);
    assertEquals((await p.apply(id)).status, 200);
    assertEquals((await p.proposals())[0].kind, 'itinerary');
  });
});

Deno.test('PDF → itinerario: un itinerario no se vincula a una solicitud ni se aplica como merge', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(1, 'itinerary');
    await p.process(id);
    const withLead = await p.apply(id, { lead_id: '11111111-1111-4111-8111-111111111111' });
    assertEquals([withLead.status, (await withLead.json()).code], [400, 'lead_not_supported']);
    assertEquals((await p.proposals()).length, 0);
  });
});

// ---------------------------------------------------------------- PROPUESTA (regresión)

Deno.test('PDF → propuesta (regresión): conserva precios, términos y moneda, y crea kind=proposal', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(2, 'proposal');
    assertEquals((await p.importRow(id)).kind, 'proposal');
    assertEquals((await p.process(id)).status, 202);

    // Prompt de siempre: sin la nota de itinerario.
    const instructions = String(p.openAiCalls[0].body.instructions);
    assertEquals(instructions, SYSTEM_PROMPT);
    assertFalse(instructions.includes(ITINERARY_PROMPT));

    const row = await p.importRow(id);
    assertEquals(row.status, 'ready');
    const saved = row.extracted as Extraction;
    assert(saved.pricing !== null && saved.pricing.lines.length > 0);
    assertEquals(saved.inclusions, ['Todo incluido', 'Traslados privados']);
    assert(saved.days.some((d) => d.services.some((s) => s.price !== null)));

    const res = await p.apply(id);
    assertEquals(res.status, 200);
    const [created] = await p.proposals();
    assertEquals([created.kind, created.status], ['proposal', 'draft']);
    assert(created.content.pricing.lines.length > 0);
    assertEquals(created.content.terms.title, 'Términos y condiciones');
    assertEquals(created.currency.length, 3);
    assertEquals((await p.importRow(id)).proposal_id, created.id);
    assertEquals((await p.importRow(id)).extracted.summary.had_pricing, true);
  });
});

Deno.test('PDF → propuesta: una importación SIN kind explícito (cliente anterior a 0055b) nace proposal y sigue funcionando', async () => {
  await withPipeline(async (p) => {
    const id = await p.upload(3, null);
    assertEquals((await p.importRow(id)).kind, 'proposal');
    assertEquals((await p.process(id)).status, 202);
    assertEquals((await p.apply(id)).status, 200);
    assertEquals((await p.proposals())[0].kind, 'proposal');
  });
});

Deno.test('PDF: un proceso y un apply de cada tipo en la misma base no se mezclan', async () => {
  await withPipeline(async (p) => {
    const itineraryImport = await p.upload(4, 'itinerary');
    const proposalImport = await p.upload(5, 'proposal');
    await p.process(itineraryImport);
    await p.process(proposalImport);
    assertEquals((await p.apply(itineraryImport, { origin_channel: 'web' })).status, 200);
    assertEquals((await p.apply(proposalImport, { origin_channel: 'email' })).status, 200);
    const created = await p.proposals();
    assertEquals(created.map((c) => c.kind).sort(), ['itinerary', 'proposal']);
    const byKind = Object.fromEntries(created.map((c) => [c.kind, c]));
    assertEquals((await p.importRow(itineraryImport)).proposal_id, byKind.itinerary.id);
    assertEquals((await p.importRow(proposalImport)).proposal_id, byKind.proposal.id);
    assertEquals(byKind.itinerary.content.pricing.lines.length, 0);
    assert(byKind.proposal.content.pricing.lines.length > 0);
  });
});
