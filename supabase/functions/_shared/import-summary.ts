// Resumen SIN datos personales de una extracción, para conservar tras aplicar la importación.
//
// Al aplicar una importación, proposal_imports.extracted (que trae nombre, correo, teléfono, hoteles,
// descripciones, precios…) se reemplaza por este resumen: ya se creó la propuesta con esos datos y el PDF
// se borró, así que no hay motivo para guardarlos dos veces. Solo cifras y códigos:
//   días, servicios (en total y por tipo), si había precios y cuántas líneas, códigos de los avisos
//   (warnings) y cuántos datos faltaban (missing, que es texto libre del modelo: solo se cuenta).
// `meta` se conserva tal cual (modelo, fecha y `usage`: tokens, costo y tiempo), solo con sus campos conocidos.
import type { Extraction } from './proposal-extraction.ts';

export interface RetainedUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  costUsd: number | null;
  totalMs: number;
}

export interface RetentionSummary {
  redacted: true;
  summary: {
    days: number;
    services: number;
    services_by_type: Record<string, number>;
    had_pricing: boolean;
    price_lines: number;
    warning_codes: string[];
    missing_count: number;
  };
  meta: { model?: string; extracted_at?: string; usage?: RetainedUsage };
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

function retainMeta(raw: unknown): RetentionSummary['meta'] {
  const meta = isRec(raw) && isRec(raw.meta) ? raw.meta : {};
  const out: RetentionSummary['meta'] = {};
  if (typeof meta.model === 'string') {
    out.model = meta.model;
  }
  if (typeof meta.extracted_at === 'string') {
    out.extracted_at = meta.extracted_at;
  }
  if (isRec(meta.usage)) {
    const u = meta.usage;
    out.usage = {
      calls: num(u.calls),
      inputTokens: num(u.inputTokens),
      outputTokens: num(u.outputTokens),
      reasoningTokens: num(u.reasoningTokens),
      costUsd: typeof u.costUsd === 'number' ? u.costUsd : null,
      totalMs: num(u.totalMs)
    };
  }
  return out;
}

/** @param rawExtracted el jsonb tal como está en proposal_imports.extracted (de ahí salen los códigos de avisos y meta). */
export function buildRetentionSummary(extraction: Extraction, rawExtracted: unknown): RetentionSummary {
  const byType: Record<string, number> = {};
  for (const day of extraction.days) {
    for (const service of day.services) {
      byType[service.type] = (byType[service.type] ?? 0) + 1;
    }
  }

  const warnings = isRec(rawExtracted) && Array.isArray(rawExtracted.warnings) ? rawExtracted.warnings : [];
  const codes = [
    ...new Set(
      warnings
        .map((w) => (isRec(w) ? w.code : null))
        .filter((c): c is string => typeof c === 'string' && /^[a-z0-9_]{1,60}$/.test(c))
    )
  ].sort();

  return {
    redacted: true,
    summary: {
      days: extraction.days.length,
      services: Object.values(byType).reduce((a, b) => a + b, 0),
      services_by_type: byType,
      had_pricing: extraction.pricing !== null,
      price_lines: extraction.pricing?.lines.length ?? 0,
      warning_codes: codes,
      missing_count: extraction.missing.length
    },
    meta: retainMeta(rawExtracted)
  };
}
