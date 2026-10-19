import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { extractTrip } from './anthropic.ts';
import { UserError } from './pdf.ts';
import { matchingExtraction } from '../_shared/test-fixtures.ts';

function apiResponse(input: unknown, stop_reason = 'tool_use'): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'tool_use', id: 'toolu_1', name: 'extract_trip', input }],
      stop_reason,
      usage: { input_tokens: 10, output_tokens: 5 }
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  );
}

function makeFetch(responses: Response[]) {
  const calls: { url: string; headers: Record<string, string>; body: Record<string, unknown> }[] = [];
  const fetchImpl = ((url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const next = responses.shift();
    if (!next) {
      throw new Error('sin más respuestas');
    }
    return Promise.resolve(next);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const opts = (fetchImpl: typeof fetch, sleeps: number[] = []) => ({
  apiKey: 'sk-test',
  model: 'claude-sonnet-5-5',
  fetchImpl,
  sleep: (ms: number) => {
    sleeps.push(ms);
    return Promise.resolve();
  }
});

Deno.test('anthropic: pide la herramienta extract_trip con el PDF como document base64', async () => {
  const { fetchImpl, calls } = makeFetch([apiResponse(matchingExtraction())]);
  const result = await extractTrip(opts(fetchImpl), 'QUJD');
  assertEquals(result.client.name, 'Familia Ejemplo');
  const call = calls[0];
  assertEquals(call.url, 'https://api.anthropic.com/v1/messages');
  assertEquals(call.headers['x-api-key'], 'sk-test');
  assertEquals(call.headers['anthropic-version'], '2023-06-01');
  assertEquals(call.body.model, 'claude-sonnet-5-5');
  assertEquals(call.body.tool_choice, { type: 'tool', name: 'extract_trip' });
  assert(String(call.body.system).includes('The Edit Assistant'));
  const content = (call.body.messages as { content: { type: string; source?: { media_type: string; data: string } }[] }[])[0].content;
  assertEquals(content[0].type, 'document');
  assertEquals(content[0].source?.media_type, 'application/pdf');
  assertEquals(content[0].source?.data, 'QUJD');
  assert(!JSON.stringify(call.body.tools).includes('$ref'));
});

Deno.test('anthropic: ante 429 espera y reintenta una vez', async () => {
  const sleeps: number[] = [];
  const { fetchImpl, calls } = makeFetch([
    new Response('{}', { status: 429, headers: { 'retry-after': '2' } }),
    apiResponse(matchingExtraction())
  ]);
  await extractTrip(opts(fetchImpl, sleeps), 'QUJD');
  assertEquals(calls.length, 2);
  assertEquals(sleeps, [2000]);
});

Deno.test('anthropic: si el 5xx se repite, falla con mensaje legible', async () => {
  const { fetchImpl, calls } = makeFetch([new Response('{}', { status: 529 }), new Response('{}', { status: 529 })]);
  const error = await assertRejects(() => extractTrip(opts(fetchImpl), 'QUJD'), UserError);
  assertEquals(calls.length, 2);
  assert(error.message.includes('saturado'));
});

Deno.test('anthropic: respuesta inválida → un reintento enviando los errores de validación', async () => {
  const invalid = JSON.parse(JSON.stringify(matchingExtraction()));
  invalid.trip.start_date = 'mañana';
  const { fetchImpl, calls } = makeFetch([apiResponse(invalid), apiResponse(matchingExtraction())]);
  const result = await extractTrip(opts(fetchImpl), 'QUJD');
  assertEquals(result.trip.start_date, '2027-03-10');
  assertEquals(calls.length, 2);
  const messages = calls[1].body.messages as { role: string; content: { type: string; is_error?: boolean; content?: string }[] }[];
  assertEquals(messages.map((m) => m.role), ['user', 'assistant', 'user']);
  const toolResult = messages[2].content[0];
  assertEquals(toolResult.type, 'tool_result');
  assertEquals(toolResult.is_error, true);
  assert(toolResult.content!.includes('trip.start_date'));
  assert(!toolResult.content!.includes('mañana'));
});

Deno.test('anthropic: si la validación falla dos veces, status failed con mensaje legible', async () => {
  const invalid = JSON.parse(JSON.stringify(matchingExtraction()));
  invalid.trip.start_date = 'mañana';
  const { fetchImpl, calls } = makeFetch([apiResponse(invalid), apiResponse(invalid)]);
  const error = await assertRejects(() => extractTrip(opts(fetchImpl), 'QUJD'), UserError);
  assertEquals(calls.length, 2);
  assert(error.message.includes('No se pudo leer el PDF'));
});

Deno.test('anthropic: respuesta cortada por max_tokens → mensaje claro', async () => {
  const { fetchImpl } = makeFetch([apiResponse({}, 'max_tokens')]);
  const error = await assertRejects(() => extractTrip(opts(fetchImpl), 'QUJD'), UserError);
  assert(error.message.includes('demasiado extenso'));
});

Deno.test('anthropic: 400 (PDF dañado) y 401 (clave) dan mensajes distintos y sin detalles técnicos', async () => {
  const bad = makeFetch([new Response('{"error":{"type":"invalid_request_error"}}', { status: 400 })]);
  const e1 = await assertRejects(() => extractTrip(opts(bad.fetchImpl), 'QUJD'), UserError);
  assert(e1.message.includes('No se pudo procesar el PDF'));
  const auth = makeFetch([new Response('{"error":{"type":"authentication_error"}}', { status: 401 })]);
  const e2 = await assertRejects(() => extractTrip(opts(auth.fetchImpl), 'QUJD'), UserError);
  assert(e2.message.includes('Avisa al administrador'));
  assert(!e2.message.includes('401'));
});
