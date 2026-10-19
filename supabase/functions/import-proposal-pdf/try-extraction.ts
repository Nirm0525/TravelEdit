// Prueba local de la extracción, sin Supabase.
//
//   $env:ANTHROPIC_API_KEY = "sk-ant-..."     # PowerShell (la clave nunca va en un archivo del repo)
//   npx deno run -A --node-modules-dir=none supabase/functions/import-proposal-pdf/try-extraction.ts <ruta-al-pdf> [--merge <archivo.json>] [--model <modelo>]
//
// Ejecuta lo mismo que la Edge Function: validación del PDF → llamada a Anthropic →
// validación zod → revisiones de coherencia. Escribe el resultado en
// tmp/extractions/<nombre>.json (carpeta ignorada por git: los PDFs de prueba y sus
// resultados nunca se commitean) y muestra un resumen en consola.
//
// --merge <archivo.json>: calcula además el diff contra una propuesta exportada. El archivo
// puede ser el `content` de la propuesta tal cual, o un objeto con `content` y, opcionalmente,
// los campos de la propuesta: client_name, client_email, client_phone, start_date, end_date,
// travelers_count, currency, pricing_total, updated_at.
import { runCoherenceChecks } from '../_shared/proposal-checks.ts';
import { computeDiff, type ProposalSnapshot } from '../_shared/proposal-diff.ts';
import { hasUsefulContent, type StoredExtraction } from '../_shared/proposal-extraction.ts';
import { extractTrip } from './anthropic.ts';
import { DEFAULT_PROCESS_DEADLINE_MS } from './handler.ts';
import { DEFAULT_MAX_PAGES, toBase64, UserError, validatePdf } from './pdf.ts';

const OUTPUT_DIR = new URL('../../../tmp/extractions/', import.meta.url);
const DEFAULT_MODEL = 'claude-sonnet-5-5';

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  Deno.exit(1);
}

function parseArgs(args: string[]): { pdf: string; merge?: string; model?: string } {
  const out: { pdf?: string; merge?: string; model?: string } = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--merge') {
      out.merge = args[++i];
    } else if (args[i] === '--model') {
      out.model = args[++i];
    } else if (!args[i].startsWith('--') && !out.pdf) {
      out.pdf = args[i];
    } else {
      fail(`Argumento no reconocido: ${args[i]}`);
    }
  }
  if (!out.pdf) {
    fail('Uso: try-extraction.ts <ruta-al-pdf> [--merge <archivo.json>] [--model <modelo>]');
  }
  if (args.includes('--merge') && !out.merge) {
    fail('--merge necesita la ruta de un archivo JSON.');
  }
  return out as { pdf: string; merge?: string; model?: string };
}

type Rec = Record<string, unknown>;

function toSnapshot(raw: unknown): ProposalSnapshot {
  const json = (raw && typeof raw === 'object' ? raw : {}) as Rec;
  const wrapped = 'content' in json && typeof json.content === 'object';
  const content = (wrapped ? json.content : json) as Rec;
  const meta = (wrapped ? json : {}) as Rec;
  const asString = (v: unknown) => (typeof v === 'string' && v ? v : null);
  const asNumber = (v: unknown) => (typeof v === 'number' ? v : null);

  const pricing = (content.pricing ?? {}) as Rec;
  const sumLines = (key: string) =>
    (Array.isArray(pricing[key]) ? (pricing[key] as Rec[]) : []).reduce(
      (acc, l) => acc + (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0),
      0
    );

  return {
    updated_at: asString(meta.updated_at) ?? new Date().toISOString(),
    client_name: asString(meta.client_name),
    client_email: asString(meta.client_email),
    client_phone: asString(meta.client_phone),
    start_date: asString(meta.start_date),
    end_date: asString(meta.end_date),
    travelers_count: asNumber(meta.travelers_count),
    currency: asString(meta.currency),
    pricing_total: asNumber(meta.pricing_total) ?? sumLines('lines') + sumLines('feesLines'),
    content
  };
}

function printSummary(stored: StoredExtraction, outputPath: string, pages: number | null): void {
  const byType: Record<string, number> = {};
  for (const day of stored.days) {
    for (const service of day.services) {
      const key = service.subtype ? `${service.type} (${service.subtype})` : service.type;
      byType[key] = (byType[key] ?? 0) + 1;
    }
  }
  const { start_date: start, end_date: end } = stored.trip;
  console.log('\n──────── Resumen ────────');
  console.log(`PDF:        ${pages ?? '?'} páginas`);
  console.log(`Modelo:     ${stored.meta.model}`);
  console.log(`Viaje:      ${start ?? '—'} → ${end ?? '—'}`);
  console.log(`Días:       ${stored.days.length}`);
  console.log(
    `Servicios:  ${Object.entries(byType).map(([k, v]) => `${k}: ${v}`).join(', ') || 'ninguno'}`
  );
  console.log(
    `Precio:     ${stored.pricing.total ?? '—'} ${stored.pricing.currency ?? ''} · ${stored.pricing.lines.length} líneas` +
      (stored.pricing.other_currencies.length ? ` · otras monedas: ${stored.pricing.other_currencies.join(', ')}` : '')
  );
  console.log(`Warnings:   ${stored.warnings.length}`);
  for (const w of stored.warnings) {
    console.log(`  ⚠ [${w.code}] ${w.message}`);
  }
  console.log(`Missing:    ${stored.missing.length}`);
  for (const m of stored.missing) {
    console.log(`  · ${m}`);
  }
  console.log(`\nResultado completo: ${outputPath}`);
}

const args = parseArgs(Deno.args);

const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
if (!apiKey) {
  fail('Falta la variable de entorno ANTHROPIC_API_KEY (no se lee de ningún archivo).');
}
const model = args.model ?? Deno.env.get('ANTHROPIC_MODEL') ?? DEFAULT_MODEL;
const maxPages = Number(Deno.env.get('PDF_MAX_PAGES')) || DEFAULT_MAX_PAGES;
const deadlineMs = Number(Deno.env.get('PROCESS_DEADLINE_MS')) || DEFAULT_PROCESS_DEADLINE_MS;

let bytes: Uint8Array;
try {
  bytes = await Deno.readFile(args.pdf);
} catch {
  fail(`No se pudo leer el archivo: ${args.pdf}`);
}

try {
  const startedAt = Date.now();
  const { pages } = validatePdf(bytes, maxPages);
  console.log(`PDF válido (${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB, ${pages ?? '?'} páginas). Llamando a ${model}…`);

  const extraction = await extractTrip(
    {
      apiKey,
      model,
      deadlineAt: startedAt + deadlineMs,
      log: (message, meta) => console.log(`  [${message}]`, meta ? JSON.stringify(meta) : '')
    },
    toBase64(bytes)
  );
  if (!hasUsefulContent(extraction)) {
    fail('El modelo no encontró información del viaje en el PDF.');
  }

  const stored: StoredExtraction = {
    ...extraction,
    warnings: runCoherenceChecks(extraction),
    meta: { model, extracted_at: new Date().toISOString() }
  };

  let diff = null;
  if (args.merge) {
    let raw: unknown;
    try {
      raw = JSON.parse(await Deno.readTextFile(args.merge));
    } catch {
      fail(`No se pudo leer o interpretar el JSON de --merge: ${args.merge}`);
    }
    diff = computeDiff(extraction, toSnapshot(raw));
  }

  await Deno.mkdir(OUTPUT_DIR, { recursive: true });
  const name = (args.pdf.split(/[\\/]/).pop() ?? 'extraccion').replace(/\.pdf$/i, '').replace(/[^\w.-]+/g, '_');
  const outputUrl = new URL(`${name}.json`, OUTPUT_DIR);
  await Deno.writeTextFile(outputUrl, JSON.stringify({ extracted: stored, diff }, null, 2));

  printSummary(stored, decodeURIComponent(outputUrl.pathname).replace(/^\//, ''), pages);
  if (diff) {
    const s = diff.summary;
    console.log('\n──────── Diff contra la propuesta ────────');
    console.log(`Servicios:  nuevos ${s.services.new} · distintos ${s.services.changed} · iguales ${s.services.unchanged} · solo en la propuesta ${s.services.only_in_proposal}`);
    console.log(`Precios:    nuevas ${s.lines.new} · distintas ${s.lines.changed} · iguales ${s.lines.unchanged} · solo en la propuesta ${s.lines.only_in_proposal}`);
    console.log(`Viaje:      inicio ${diff.trip.start_date.status} · fin ${diff.trip.end_date.status} · moneda ${diff.pricing.currency.status} · total ${diff.pricing.total.status}`);
  }
} catch (err) {
  if (err instanceof UserError) {
    fail(`${err.message}${err.technical ? `  (detalle técnico: ${err.technical})` : ''}`);
  }
  throw err;
}
