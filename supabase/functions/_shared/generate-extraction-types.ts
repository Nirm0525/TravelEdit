// Genera los tipos TypeScript de Angular a partir del schema zod (única fuente
// de verdad) y de las interfaces del diff.
//
//   deno run -A supabase/functions/_shared/generate-extraction-types.ts          # escribe el archivo
//   deno run -A supabase/functions/_shared/generate-extraction-types.ts --check  # falla si está desactualizado
import { extractionToolInputSchema } from './proposal-extraction.ts';

const OUTPUT = new URL('../../../projects/admin/src/app/core/models/proposal-extraction.types.ts', import.meta.url);
const DIFF_SOURCE = new URL('./proposal-diff.ts', import.meta.url);

// deno-lint-ignore no-explicit-any
function toTs(schema: any, indent: string): string {
  if (schema.anyOf) {
    return [...new Set(schema.anyOf.map((s: unknown) => toTs(s, indent)))].join(' | ');
  }
  if (schema.enum) {
    return schema.enum.map((v: unknown) => JSON.stringify(v)).join(' | ');
  }
  if (Array.isArray(schema.type)) {
    return [...new Set(schema.type.map((type: string) => toTs({ ...schema, type }, indent)))].join(' | ');
  }
  switch (schema.type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      const item = toTs(schema.items, indent);
      return item.includes(' | ') && !item.startsWith('{') ? `(${item})[]` : `${item}[]`;
    }
    case 'object': {
      const inner = indent + '  ';
      const required = new Set<string>(schema.required ?? []);
      const lines = Object.entries(schema.properties ?? {}).map(([key, value]) => {
        // deno-lint-ignore no-explicit-any
        const description = (value as any).description ? `${inner}/** ${(value as any).description} */\n` : '';
        return `${description}${inner}${key}${required.has(key) ? '' : '?'}: ${toTs(value, inner)};`;
      });
      return `{\n${lines.join('\n')}\n${indent}}`;
    }
    default:
      throw new Error(`Tipo de schema no soportado: ${JSON.stringify(schema)}`);
  }
}

export function renderTypes(rawDiffSource: string): string {
  const diffSource = rawDiffSource.split(String.fromCharCode(13, 10)).join(String.fromCharCode(10));
  const start = diffSource.indexOf('export type ChangeStatus');
  const end = diffSource.indexOf('// ---------------------------------------------------------------- utilidades');
  if (start < 0 || end < 0) {
    throw new Error('No se encontraron los marcadores de tipos en proposal-diff.ts');
  }
  const diffTypes = diffSource.slice(start, end).trim();

  return `// GENERADO — no editar a mano.
// Fuente: supabase/functions/_shared/proposal-extraction.ts (schema zod) y
// supabase/functions/_shared/proposal-diff.ts (interfaces del diff).
// Regenerar: deno run -A supabase/functions/_shared/generate-extraction-types.ts

export type TripExtraction = ${toTs(extractionToolInputSchema(), '')};

export type ExtractedDay = TripExtraction['days'][number];
export type ExtractedService = ExtractedDay['services'][number];
export type ExtractedPriceLine = NonNullable<TripExtraction['pricing']>['lines'][number];

export interface ExtractionWarning {
  code: string;
  message: string;
}

/** Lo que se guarda en proposal_imports.extracted. */
export interface StoredExtraction extends TripExtraction {
  warnings: ExtractionWarning[];
  meta: {
    model: string;
    extracted_at: string;
    /** Uso del modelo en esta extracción (sin contenido del PDF ni datos del cliente). */
    usage?: { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number | null; totalMs: number };
  };
}

${diffTypes}
`;
}

if (import.meta.main) {
  const generated = renderTypes(await Deno.readTextFile(DIFF_SOURCE));
  if (Deno.args.includes('--check')) {
    const current = (await Deno.readTextFile(OUTPUT).catch(() => '')).replace(/\r\n/g, '\n');
    if (current !== generated) {
      console.error('proposal-extraction.types.ts está desactualizado. Regéneralo.');
      Deno.exit(1);
    }
    console.log('proposal-extraction.types.ts está al día.');
  } else {
    await Deno.writeTextFile(OUTPUT, generated);
    console.log('Escrito', OUTPUT.pathname);
  }
}
