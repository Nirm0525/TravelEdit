// Prueba local de la extracción, sin Supabase.
//
//   $env:OPENAI_API_KEY = "sk-..."     # PowerShell (la clave nunca va en un archivo del repo)
//   npx deno run -A --node-modules-dir=none supabase/functions/import-proposal-pdf/try-extraction.ts <ruta-al-pdf> [--merge <archivo.json>] [--model <modelo>] [--price-in <usd/1M>] [--price-out <usd/1M>]
//
// Ejecuta lo mismo que la Edge Function: validación del PDF → llamada a OpenAI (API Responses, salida
// estructurada estricta) → validación zod → revisiones de coherencia. Escribe el resultado en
// tmp/extractions/<nombre>.json (carpeta ignorada por git: los PDFs de prueba y sus
// resultados nunca se commitean) y muestra un resumen en consola; al final: modelo usado, tokens de
// entrada y de salida, costo estimado y tiempo total.
//
// Configuración (las mismas variables que los secrets de la función): OPENAI_MODEL (por defecto
// gpt-6.1-sol), OPENAI_PDF_DETAIL (por defecto high), OPENAI_REASONING_EFFORT, OPENAI_MAX_OUTPUT_TOKENS,
// PDF_MAX_PAGES y PROCESS_DEADLINE_MS. Precios para el costo estimado: tabla PRICES_USD_PER_M de abajo,
// o --price-in / --price-out, o OPENAI_PRICE_INPUT_PER_M / OPENAI_PRICE_OUTPUT_PER_M.
//
// --merge <archivo.json>: calcula además el diff contra una propuesta exportada. El archivo
// puede ser el `content` de la propuesta tal cual, o un objeto con `content` y, opcionalmente,
// los campos de la propuesta: client_name, client_email, client_phone, start_date, end_date,
// travelers_count, currency, pricing_total, updated_at.
import { runCoherenceChecks } from '../_shared/proposal-checks.ts';
import { postProcessExtraction } from '../_shared/proposal-postprocess.ts';
import { computeDiff, type ProposalSnapshot } from '../_shared/proposal-diff.ts';
import { hasUsefulContent, type StoredExtraction } from '../_shared/proposal-extraction.ts';
import { extractTrip, readProviderSettings, type Usage } from './openai.ts';
import { DEFAULT_PROCESS_DEADLINE_MS } from './handler.ts';
import { DEFAULT_MAX_PAGES, toBase64, UserError, validatePdf } from './pdf.ts';

const OUTPUT_DIR = new URL('../../../tmp/extractions/', import.meta.url);

/**
 * Precios de referencia en USD por 1 M de tokens (entrada / salida), de la página de modelos de OpenAI.
 * Son estimaciones: edítalos aquí o sobrescríbelos con --price-in / --price-out. Los tokens de
 * razonamiento se cobran como salida y ya vienen incluidos en los de salida.
 */
const PRICES_USD_PER_M: Record<string, { input: number; output: number }> = {
  'gpt-6.1-sol': { input: 2, output: 10 },
  'gpt-6-astra': { input: 10, output: 50 },
  'gpt-6-luna': { input: 0.1, output: 0.5 }
};

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  Deno.exit(1);
}

interface Args {
  pdf: string;
  merge?: string;
  model?: string;
  priceIn?: number;
  priceOut?: number;
}

function parseArgs(args: string[]): Args {
  const out: { pdf?: string; merge?: string; model?: string; priceIn?: number; priceOut?: number } = {};
  const price = (flag: string, value: string | undefined): number => {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) {
      fail(`${flag} necesita un número (USD por millón de tokens).`);
    }
    return n;
  };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--merge') {
      out.merge = args[++i];
    } else if (args[i] === '--model') {
      out.model = args[++i];
    } else if (args[i] === '--price-in') {
      out.priceIn = price('--price-in', args[++i]);
    } else if (args[i] === '--price-out') {
      out.priceOut = price('--price-out', args[++i]);
    } else if (!args[i].startsWith('--') && !out.pdf) {
      out.pdf = args[i];
    } else {
      fail(`Argumento no reconocido: ${args[i]}`);
    }
  }
  if (!out.pdf) {
    fail('Uso: try-extraction.ts <ruta-al-pdf> [--merge <archivo.json>] [--model <modelo>] [--price-in <usd/1M>] [--price-out <usd/1M>]');
  }
  if (args.includes('--merge') && !out.merge) {
    fail('--merge necesita la ruta de un archivo JSON.');
  }
  return out as Args;
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
  const pricing = stored.pricing;
  console.log(
    pricing
      ? `Precio:     ${pricing.total ?? '—'} ${pricing.currency ?? ''} · ${pricing.lines.length} líneas` +
          (pricing.other_currencies.length ? ` · otras monedas: ${pricing.other_currencies.join(', ')}` : '')
      : 'Precio:     (el PDF no trae precios)'
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

function printCost(model: string, detail: string, usages: Usage[], elapsedMs: number, args: Args): void {
  const input = usages.reduce((n, u) => n + u.inputTokens, 0);
  const output = usages.reduce((n, u) => n + u.outputTokens, 0);
  const reasoning = usages.reduce((n, u) => n + u.reasoningTokens, 0);

  const known = PRICES_USD_PER_M[model];
  const priceIn = args.priceIn ?? (Number(Deno.env.get('OPENAI_PRICE_INPUT_PER_M')) || known?.input);
  const priceOut = args.priceOut ?? (Number(Deno.env.get('OPENAI_PRICE_OUTPUT_PER_M')) || known?.output);

  console.log('\n──────── Uso y costo ────────');
  console.log(`Modelo:           ${model} (detalle de imagen: ${detail})`);
  console.log(`Llamadas:         ${usages.length}${usages.length > 1 ? ' (la segunda fue el reintento por validación)' : ''}`);
  console.log(`Tokens de entrada: ${input.toLocaleString('es')}`);
  console.log(`Tokens de salida:  ${output.toLocaleString('es')}${reasoning > 0 ? ` (de ellos ${reasoning.toLocaleString('es')} de razonamiento)` : ''}`);
  if (priceIn !== undefined && priceOut !== undefined) {
    const cost = (input * priceIn + output * priceOut) / 1_000_000;
    console.log(`Costo estimado:   US$ ${cost.toFixed(4)}  (entrada US$ ${priceIn}/1M · salida US$ ${priceOut}/1M)`);
  } else {
    console.log(`Costo estimado:   sin precio para "${model}": usa --price-in y --price-out (USD por millón de tokens)`);
  }
  console.log(`Tiempo total:     ${(elapsedMs / 1000).toFixed(1)} s`);
}

const args = parseArgs(Deno.args);

const apiKey = Deno.env.get('OPENAI_API_KEY');
if (!apiKey) {
  fail('Falta la variable de entorno OPENAI_API_KEY (no se lee de ningún archivo).');
}
const provider = readProviderSettings((name) => Deno.env.get(name));
const model = args.model ?? provider.model;
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

  const usages: Usage[] = [];
  const raw = await extractTrip(
    {
      apiKey,
      ...provider,
      model,
      deadlineAt: startedAt + deadlineMs,
      onUsage: (usage) => void usages.push(usage),
      log: (message, meta) => console.log(`  [${message}]`, meta ? JSON.stringify(meta) : '')
    },
    toBase64(bytes)
  );
  const { extraction, warnings: postWarnings } = postProcessExtraction(raw);
  if (!hasUsefulContent(extraction)) {
    fail('El modelo no encontró información del viaje en el PDF.');
  }

  const stored: StoredExtraction = {
    ...extraction,
    warnings: [...postWarnings, ...runCoherenceChecks(extraction)],
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

  printCost(model, provider.detail, usages, Date.now() - startedAt, args);
} catch (err) {
  if (err instanceof UserError) {
    fail(`${err.message}${err.technical ? `  (detalle técnico: ${err.technical})` : ''}`);
  }
  throw err;
}
