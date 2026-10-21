// Genera 0055_travel_kinds_rollback.sql a partir de la salida REAL del preflight (0055_travel_kinds_preflight.sql).
//
// La reversión debe devolver producción EXACTAMENTE al estado previo observado, no a lo que dice el repositorio (ya hubo
// deriva: 0035, 0042, 0051). Por eso este script no copia nada del repo: lee del resultado del preflight, tomado ANTES de aplicar
// 0055, las definiciones de las funciones (section 'function.def'), sus EXECUTE (function.grants), las policies (rls.policies),
// el CHECK de status (table.constraints) y la ACL de la tabla y de sus columnas (table.acl).
//
// Uso (Deno):
//   deno run -A supabase/migration-scripts/0055_generate_rollback.ts <resultado-preflight.json|.csv> > supabase/migration-scripts/0055_travel_kinds_rollback.sql
// El resultado del SQL Editor se exporta como CSV (section,item,detail) o JSON (arreglo de objetos con esas tres claves).

export interface PreflightRow {
  section: string;
  item: string;
  detail: string;
}

// Funciones cuyo CUERPO cambia 0055 (se restaura la definición real) …
const RESTORED_FUNCTIONS = [
  'publish_proposal',
  'unpublish_proposal',
  'accept_proposal',
  'set_proposal_service_choice',
  'set_proposal_service_comment',
  'get_proposal_gate',
  'verify_proposal_access',
  'get_proposal_content',
  'recompute_proposal_pricing',
  'log_proposal_created',
  'log_proposal_status_change',
  'log_proposal_deleted',
  'set_proposal_access_code',
  'generate_proposal_access_code'
];
// … y funciones de trigger a las que 0055 solo les quita EXECUTE (se restauran sus grants).
const GRANT_ONLY_FUNCTIONS = [
  'enforce_proposal_advisor',
  'enforce_credential_ownership',
  'recompute_proposal_pricing',
  // 0055 las reemplaza con CREATE OR REPLACE (conserva la ACL), pero se restaura igualmente la ACL REAL observada: solo postgres y service_role.
  'log_proposal_created',
  'log_proposal_status_change',
  'log_proposal_deleted'
];
// Cambian de forma de retorno: se borran y se recrean, así que su ACL también se restaura (CREATE OR REPLACE conserva la ACL del resto).
const DROP_BEFORE_RESTORE = new Set(['get_proposal_gate', 'get_proposal_content']);

const PRIVS: Record<string, string> = { a: 'INSERT', r: 'SELECT', w: 'UPDATE', d: 'DELETE', D: 'TRUNCATE', x: 'REFERENCES', t: 'TRIGGER' };

/** CSV con comillas y saltos de línea dentro de los campos (RFC 4180). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') {
        quoted = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '') !== '');
}

export function loadPreflight(text: string): PreflightRow[] {
  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    return (JSON.parse(trimmed) as PreflightRow[]).map((r) => ({ section: r.section, item: r.item, detail: r.detail ?? '' }));
  }
  const [header, ...body] = parseCsv(trimmed);
  const idx = (name: string) => header.indexOf(name);
  if (idx('section') < 0 || idx('item') < 0 || idx('detail') < 0) {
    throw new Error('El CSV debe tener las columnas section, item y detail.');
  }
  // El export CSV del SQL Editor de Supabase DUPLICA cada barra invertida (comprobado en el preflight real: todas las rachas de «\\»
  // son de longitud par; p. ej. el salto de línea JSON `\n` llega como `\\n`). Se deshace aquí; un JSON no lo necesita.
  const undouble = (v: string) => v.replaceAll('\\\\', '\\');
  return body.map((r) => ({ section: r[idx('section')], item: r[idx('item')], detail: undouble(r[idx('detail')] ?? '') }));
}

const quoteIdent = (s: string) => `"${s.replaceAll('"', '""')}"`;
const nameOf = (item: string) => item.replace(/^[^.]+\./, '').replace(/\(.*$/s, '');
const sigOf = (item: string) => item; // «public.publish_proposal(p_id uuid)»: sirve tal cual en GRANT/REVOKE/DROP

function parseAcl(acl: string): { grantee: string; privs: string[] }[] {
  const inner = acl.trim().replace(/^\{/, '').replace(/\}$/, '');
  if (!inner || inner.startsWith('(')) return [];
  return inner
    .split(',')
    .map((entry) => entry.replace(/^"|"$/g, ''))
    .map((entry) => {
      const [left] = entry.split('/');
      const [grantee, privs = ''] = left.split('=');
      return { grantee: grantee === '' ? 'public' : grantee, privs: [...privs].filter((p) => p in PRIVS).map((p) => PRIVS[p]) };
    });
}

function grantsFor(sig: string, detail: string): string[] {
  const out = [`revoke all on function ${sig} from public, anon, authenticated;`];
  const grantees = detail.startsWith('sin ACL')
    ? ['PUBLIC'] // sin ACL explícita = PUBLIC puede ejecutar (lo de por defecto)
    : detail.split(',').map((g) => g.trim().split(':')[0]).filter((g) => g && g !== 'postgres' && g !== 'supabase_admin');
  const unique = [...new Set(grantees)];
  if (unique.length > 0) {
    out.push(`grant execute on function ${sig} to ${unique.map((g) => (g === 'PUBLIC' ? 'public' : quoteIdent(g))).join(', ')};`);
  }
  return out;
}

export function buildRollback(rows: PreflightRow[]): string {
  const by = (section: string) => rows.filter((r) => r.section === section);
  // Las funciones de auditoría pueden venir en 'audit.functions' (preflights anteriores no las incluían en function.def).
  const defs = [...by('function.def'), ...by('audit.functions')].map((r) => ({ ...r, detail: r.detail.replaceAll('\r\n', '\n') }));
  const grants = new Map(by('function.grants').map((r) => [r.item, r.detail]));
  const out: string[] = [];
  const missing: string[] = [];

  const defOf = (fn: string) => {
    const row = defs.find((r) => nameOf(r.item) === fn && r.item.startsWith('public.'));
    if (!row) missing.push(`function.def de public.${fn}`);
    return row;
  };

  out.push(`-- Reversión de 0055 (Viajes: kind / itinerarios). GENERADA por 0055_generate_rollback.ts desde el preflight REAL de producción.
-- DESTRUCTIVA: borra las columnas kind y shared_at. Se NIEGA a ejecutarse si existe al menos un itinerario (kind = 'itinerary').
-- Restaura las funciones, policies, CHECK de status y privilegios a lo observado en producción ANTES de 0055.
-- Ejecutar a mano (NO es una migración; por eso vive fuera de supabase/migrations):
--   supabase db query --linked -f supabase/migration-scripts/0055_travel_kinds_rollback.sql
begin;

do $$
begin
  if exists (select 1 from public.proposals where kind = 'itinerary') then
    raise exception 'Hay itinerarios (kind = itinerary): no se revierte 0055. Elimínalos o expórtalos antes.';
  end if;
end $$;

-- Triggers y funciones que añadió 0055.
drop trigger if exists trg_proposal_imports_only_proposals on public.proposal_imports;
drop function if exists public.enforce_import_targets_proposal();
drop trigger if exists trg_proposals_kind_immutable on public.proposals;
drop function if exists public.enforce_proposal_kind_immutable();

-- Policies (dependen de kind y de can_travel): se borran las de 0055 y se recrean las reales de producción.
drop policy if exists proposals_select on public.proposals;
drop policy if exists proposals_insert on public.proposals;
drop policy if exists proposals_update on public.proposals;
drop policy if exists proposals_delete on public.proposals;
drop policy if exists psa_select on public.proposal_service_attachments;`);

  const policies = by('rls.policies').filter((r) => ['proposals.', 'proposal_service_attachments.'].some((p) => r.item.startsWith(p)));
  for (const row of policies) {
    const [table, ...rest] = row.item.split('.');
    const name = rest.join('.');
    if (!['proposals_select', 'proposals_insert', 'proposals_update', 'proposals_delete', 'psa_select'].includes(name)) continue;
    const p = JSON.parse(row.detail) as { command: string; permissive: string; roles: string[] | string; using: string | null; with_check: string | null };
    const roles = Array.isArray(p.roles) ? p.roles : String(p.roles).replace(/[{}]/g, '').split(',');
    const to = roles.length === 1 && roles[0] === 'public' ? '' : ` to ${roles.map((r) => (r === 'public' ? 'public' : quoteIdent(r))).join(', ')}`;
    out.push(
      `create policy ${quoteIdent(name)} on public.${quoteIdent(table)} as ${p.permissive.toLowerCase()} for ${p.command.toLowerCase()}${to}` +
        `${p.using ? `\n  using (${p.using})` : ''}${p.with_check ? `\n  with check (${p.with_check})` : ''};`
    );
  }
  for (const needed of ['proposals_select', 'proposals_insert', 'proposals_update', 'proposals_delete']) {
    if (!policies.some((r) => r.item === `proposals.${needed}`)) missing.push(`rls.policies de proposals.${needed}`);
  }
  if (!policies.some((r) => r.item === 'proposal_service_attachments.psa_select')) missing.push('rls.policies de proposal_service_attachments.psa_select');

  out.push('\ndrop function if exists public.can_travel(text, text);\n\n-- Funciones: definiciones REALES previas.');
  for (const fn of RESTORED_FUNCTIONS) {
    const def = defOf(fn);
    if (!def) continue;
    if (DROP_BEFORE_RESTORE.has(fn)) out.push(`drop function if exists ${sigOf(def.item)};`);
    out.push(`${def.detail.trim().replace(/;$/, '')};`);
    // CREATE OR REPLACE conserva la ACL: solo se restaura la de las funciones que se borran y recrean.
    if (DROP_BEFORE_RESTORE.has(fn)) {
      const g = grants.get(def.item);
      if (g === undefined) missing.push(`function.grants de ${def.item}`);
      else out.push(...grantsFor(sigOf(def.item), g));
    }
  }
  for (const fn of GRANT_ONLY_FUNCTIONS) {
    const row = by('function.grants').find((r) => nameOf(r.item) === fn && r.item.startsWith('public.'));
    if (!row) missing.push(`function.grants de public.${fn}`);
    else out.push(...grantsFor(sigOf(row.item), row.detail));
  }

  out.push('\n-- Constraints y columnas (el CHECK de status vuelve a su definición real).');
  out.push(
    'alter table public.proposals drop constraint if exists proposals_kind_shape_check;\n' +
      'alter table public.proposals drop constraint if exists proposals_kind_status_check;\n' +
      'alter table public.proposals drop constraint if exists proposals_kind_check;'
  );
  const statusCheck = by('table.constraints').find((r) => r.detail.includes("'published'") && r.detail.includes("'accepted'"));
  if (!statusCheck) missing.push('table.constraints del CHECK de status');
  else out.push(`alter table public.proposals add constraint ${quoteIdent(statusCheck.item.replace(/ \(c\)$/, ''))} ${statusCheck.detail};`);
  out.push('alter table public.proposals drop column if exists shared_at;\nalter table public.proposals drop column if exists kind;');

  out.push('\n-- Privilegios de la tabla y de sus columnas (ACL real previa).');
  out.push('revoke all on table public.proposals from anon, authenticated;');
  const relacl = by('table.acl').find((r) => r.item === 'relacl');
  if (relacl) {
    for (const { grantee, privs } of parseAcl(relacl.detail)) {
      if (!['anon', 'authenticated', 'public'].includes(grantee) || privs.length === 0) continue;
      out.push(`grant ${privs.join(', ')} on table public.proposals to ${grantee};`);
    }
  } else {
    // Preflight sin 'table.acl': los GRANT de TABLA salen de las filas «table <rol> <privilegio>» (information_schema).
    // Las filas «column …» no se usan: con un GRANT de tabla, information_schema lista también todas las columnas.
    const byRole = new Map<string, string[]>();
    for (const row of by('table.privileges')) {
      const m = /^table (anon|authenticated|PUBLIC) ([A-Z]+)$/.exec(row.item);
      if (m) byRole.set(m[1].toLowerCase(), [...(byRole.get(m[1].toLowerCase()) ?? []), m[2]]);
    }
    for (const [role, privs] of byRole) out.push(`grant ${privs.join(', ')} on table public.proposals to ${role};`);
    const columnOnly = by('table.privileges').some((r) => r.item.startsWith('column ') && !byRole.has(r.item.split(' ')[1]));
    if (columnOnly) missing.push('table.acl (hay privilegios por columna sin GRANT de tabla: re-ejecuta el preflight actualizado)');
  }
  for (const row of by('table.acl').filter((r) => r.item.startsWith('column '))) {
    const col = row.item.replace(/^column /, '');
    for (const { grantee, privs } of parseAcl(row.detail)) {
      if (!['anon', 'authenticated', 'public'].includes(grantee) || privs.length === 0) continue;
      out.push(`grant ${privs.map((p) => `${p.toLowerCase()} (${quoteIdent(col)})`).join(', ')} on public.proposals to ${grantee};`);
    }
  }
  out.push('\ncommit;\n');

  if (missing.length > 0) {
    throw new Error(`El resultado del preflight no tiene todo lo necesario para generar la reversión: ${missing.join('; ')}`);
  }
  return out.join('\n');
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error('Uso: deno run -A 0055_generate_rollback.ts <resultado-preflight.json|.csv>');
    Deno.exit(2);
  }
  console.log(buildRollback(loadPreflight(Deno.readTextFileSync(path))));
}
