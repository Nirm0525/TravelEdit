import { assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { buildRetentionSummary } from './import-summary.ts';
import { postProcessExtraction } from './proposal-postprocess.ts';
import { extraction } from './test-fixtures.ts';
import { rawVoucherExtraction } from './test-fixtures-voucher.ts';

const USAGE = { calls: 2, inputTokens: 20_500, outputTokens: 3_000, reasoningTokens: 300, costUsd: 0.071, totalMs: 4321 };

/** Lo que hay en proposal_imports.extracted al terminar la extracción: la extracción + avisos + meta. */
function stored() {
  const clean = postProcessExtraction(rawVoucherExtraction()).extraction;
  return {
    clean,
    raw: {
      ...clean,
      warnings: [
        { code: 'sensitive_data_removed', message: 'Se eliminaron datos sensibles ... en: days.0.services.1.description.' },
        { code: 'days_merged', message: 'Se unieron 1 día repetido ...' },
        { code: 'days_merged', message: 'otro igual' }
      ],
      meta: { model: 'gpt-6.1-sol', extracted_at: '2027-01-01T00:00:00Z', usage: USAGE }
    }
  };
}

Deno.test('resumen: días, servicios por tipo, precios, avisos y faltantes', () => {
  const { clean, raw } = stored();
  const { summary } = buildRetentionSummary(clean, raw);
  assertEquals(summary.days, 4);
  assertEquals(summary.services, 6);
  assertEquals(summary.services_by_type, { flight: 2, other: 1, hotel: 1, transfer: 1, activity: 1 });
  assertEquals(summary.had_pricing, true);
  assertEquals(summary.price_lines, 1);
  assertEquals(summary.warning_codes, ['days_merged', 'sensitive_data_removed']); // únicos y ordenados
  assertEquals(summary.missing_count, clean.missing.length);
});

Deno.test('resumen: no lleva NINGÚN dato personal ni texto del PDF', () => {
  const { clean, raw } = stored();
  const text = JSON.stringify(buildRetentionSummary(clean, raw));
  for (const secret of [
    'Persona Ejemplo', 'persona@ejemplo.test', '+5491155550000', 'Hotel Faro', 'Plan Viaje Seguro', 'Paseo en barco',
    'Isla Central', 'Puerto Azul', 'Aerolínea Ficticia', 'Van 8', 'Paquete', 'Se eliminaron datos sensibles', 'days.0.services'
  ]) {
    assertFalse(text.includes(secret), 'no debe aparecer ' + secret);
  }
  assertEquals(buildRetentionSummary(clean, raw).redacted, true);
});

Deno.test('resumen: meta (modelo, fecha y usage) se conserva tal cual', () => {
  const { clean, raw } = stored();
  assertEquals(buildRetentionSummary(clean, raw).meta, { model: 'gpt-6.1-sol', extracted_at: '2027-01-01T00:00:00Z', usage: USAGE });
});

Deno.test('resumen: de meta solo pasan los campos conocidos (nada colado)', () => {
  const { clean, raw } = stored();
  const dirty = { ...raw, meta: { ...raw.meta, cliente: 'Persona Ejemplo', usage: { ...USAGE, nota: 'secreto', calls: 'no es número' } } };
  const meta = buildRetentionSummary(clean, dirty).meta;
  assertEquals(Object.keys(meta).sort(), ['extracted_at', 'model', 'usage']);
  assertEquals(Object.keys(meta.usage!).sort(), ['calls', 'costUsd', 'inputTokens', 'outputTokens', 'reasoningTokens', 'totalMs']);
  assertEquals(meta.usage!.calls, 0); // un valor que no es número no se arrastra
  assertFalse(JSON.stringify(meta).includes('secreto'));
  assertFalse(JSON.stringify(meta).includes('Persona'));
});

Deno.test('resumen: sin precios, sin avisos y sin meta (importaciones antiguas) no rompe', () => {
  const summary = buildRetentionSummary(extraction(), { client: { name: 'X' } });
  assertEquals(summary.summary, { days: 0, services: 0, services_by_type: {}, had_pricing: false, price_lines: 0, warning_codes: [], missing_count: 0 });
  assertEquals(summary.meta, {});
});

Deno.test('resumen: un código de aviso con formato raro no se copia', () => {
  const summary = buildRetentionSummary(extraction(), { warnings: [{ code: 'Persona Ejemplo <script>' }, { code: 'ok_code' }, { nocode: 1 }, 'texto'] });
  assertEquals(summary.summary.warning_codes, ['ok_code']);
});
