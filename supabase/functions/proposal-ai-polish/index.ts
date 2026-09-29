// Edge Function: proposal-ai-polish
//
// Única frontera entre Angular y OpenAI para el paso "AI Polish" del Smart
// Proposal Builder. OPENAI_API_KEY vive solo en Supabase Edge Function
// Secrets (Deno.env.get) — nunca llega al body, a un header enviado por
// Angular, a un query param ni a la base de datos. Angular nunca llama a
// OpenAI directo (ver ProposalAiService.polish()).
//
// Autenticación/autorización: mismo patrón que admin-users/send-proposal —
// callerClient (anon key + JWT del que llama) valida la sesión con
// auth.getUser(), y la autorización reutiliza can_manage_proposals() vía
// RPC (0029_proposals.sql) en vez de duplicar lógica de roles. Esta función
// nunca escribe en la base — no necesita, y por eso no usa, la service
// role en ningún momento.
import { createClient } from 'npm:@supabase/supabase-js@2';
import OpenAI from 'npm:openai@4';

// Modelo económico para tareas editoriales (reescritura de tono, no
// razonamiento complejo) — no el modelo más caro del catálogo. Centralizado
// acá para no repetir el string por el archivo; si OpenAI publica un modelo
// más nuevo/barato equivalente en la cuenta real, se cambia solo acá.
const OPENAI_MODEL = 'gpt-4o-mini';

const AI_TIMEOUT_MS = 25_000;
const MAX_TEXT_LENGTH = 8000;

type AiOperation = 'improve' | 'luxury_rewrite' | 'concise' | 'expand' | 'title_options';
const OPERATIONS: AiOperation[] = ['improve', 'luxury_rewrite', 'concise', 'expand', 'title_options'];

interface RequestBody {
  operation?: string;
  text?: string;
  context?: {
    destination?: string;
    section?: string;
  };
}

// ------------------------------------------------------------------
// Modo "chat" — The Edit Assistant conversacional (mensaje libre en vez de
// elegir campo + estilo de una lista fija). El cliente sigue siendo dueño
// de la lista de campos válidos de ESTA propuesta (mismo buildTargetOptions
// que ya usaba el selector de chips) — se la manda en `targets` y OpenAI
// elige `targetKey` con un enum acotado a esas claves EXACTAS, nunca puede
// inventar un dayId/serviceId que no exista. Sin esto, un modelo con
// libertad total podría "editar" un día que no existe.
// ------------------------------------------------------------------
interface ChatTarget {
  key: string;
  label: string;
  currentText: string;
}

interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  mode: 'chat';
  message?: string;
  targets?: ChatTarget[];
  history?: ChatTurn[];
  context?: { destination?: string };
}

const MAX_CHAT_MESSAGE_LENGTH = 1000;
const MAX_CHAT_HISTORY_TURNS = 6;
const MAX_CHAT_PAYLOAD_LENGTH = 40_000;

function isChatBody(value: unknown): value is ChatRequestBody {
  return !!value && typeof value === 'object' && (value as Record<string, unknown>).mode === 'chat';
}

// Mismos orígenes reales que el resto de las Edge Functions del proyecto
// (admin-users, send-proposal, save-rich-content) — nada de "*".
const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function isOperation(value: unknown): value is AiOperation {
  return typeof value === 'string' && (OPERATIONS as string[]).includes(value);
}

// ------------------------------------------------------------------
// Prompt de sistema: reglas no negociables. OpenAI edita redacción, nunca
// hechos comerciales — ver requisito del producto (Fase AI Polish).
// ------------------------------------------------------------------
const SYSTEM_PROMPT = `Eres el editor de copy premium de The Travel Edit, una agencia de viajes de lujo.

Tu trabajo es pulir la redacción de fragmentos de una propuesta de viaje real. Debes preservar EXACTAMENTE:
- nombres propios, personas y destinos
- fechas
- cantidades y número de viajeros
- servicios ya seleccionados (hoteles, traslados, actividades, vuelos, restaurantes, tickets)
- precios, monedas y porcentajes
- políticas y condiciones comerciales existentes (depósitos, cancelaciones, penalidades, reembolsos)

Tienes PROHIBIDO, bajo cualquier circunstancia:
- inventar o cambiar precios, tarifas o depósitos
- inventar o afirmar disponibilidad
- inventar vuelos, hoteles, actividades, traslados o cualquier servicio no mencionado
- cambiar fechas
- inventar o cambiar políticas, condiciones comerciales, cancelaciones, penalidades o reembolsos
- afirmar confirmaciones que no existan en el texto original
- agregar garantías no presentes en el texto original

Si falta información para completar una idea, NO la inventes — trabaja solo con lo que el texto ya dice.

El resultado debe sonar elegante, natural, premium, editorial y humano — turístico pero sin clichés excesivos, y sin sonar artificial o genérico.

Responde siempre en el mismo idioma principal del texto de entrada (si el texto está en español, responde en español).`;

function operationInstructions(operation: AiOperation): string {
  switch (operation) {
    case 'improve':
      return 'Mejora claridad, gramática, ritmo y estilo del texto. Mantén exactamente el mismo significado — no es una reescritura de tono, es una corrección editorial.';
    case 'luxury_rewrite':
      return 'Reescribe el texto con un tono premium/luxury: elegante y aspiracional, pero natural, nunca exagerado. Los mismos hechos, presentados con más categoría editorial.';
    case 'concise':
      return 'Reduce la longitud del texto conservando toda la información esencial — no borres hechos importantes (servicios, fechas, cantidades, condiciones) solo por acortar.';
    case 'expand':
      return 'Enriquece la narrativa y mejora la fluidez del texto. NO introduzcas hechos nuevos que no estén ya en el texto original — solo desarrolla mejor lo que ya está.';
    case 'title_options':
      return 'Genera 3 alternativas de título breves y diferenciadas entre sí, basadas EXCLUSIVAMENTE en la información ya presente en el texto de entrada. No inventes datos que no estén ahí.';
  }
}

function buildUserPrompt(operation: AiOperation, text: string, context?: RequestBody['context']): string {
  const parts: string[] = [];
  parts.push(`Operación: ${operation}`);
  parts.push(operationInstructions(operation));
  if (context?.destination) {
    parts.push(`Destino del viaje (contexto, no lo cambies): ${context.destination}`);
  }
  if (context?.section) {
    parts.push(`Sección de la propuesta a la que pertenece este texto: ${context.section}`);
  }
  parts.push('--- TEXTO ORIGINAL ---');
  parts.push(text);
  return parts.join('\n');
}

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    text: { type: 'string', description: "Resultado para improve/luxury_rewrite/concise/expand. Cadena vacía si la operación es title_options." },
    alternatives: {
      type: 'array',
      items: { type: 'string' },
      description: 'Alternativas de título para title_options. Array vacío para cualquier otra operación.'
    }
  },
  required: ['text', 'alternatives'],
  additionalProperties: false
};

interface AiResult {
  text: string;
  alternatives: string[];
}

function isValidAiResult(value: unknown): value is AiResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.text === 'string' && Array.isArray(v.alternatives) && v.alternatives.every((a) => typeof a === 'string');
}

// ------------------------------------------------------------------
// Prompt de sistema del modo chat: mismas reglas de preservación de hechos
// que SYSTEM_PROMPT, más la tarea de identificar A CUÁL campo se refiere el
// mensaje del usuario, tomando la clave EXACTA de la lista provista.
// ------------------------------------------------------------------
const CHAT_SYSTEM_PROMPT = `Eres "The Edit Assistant", el editor de copy premium de The Travel Edit, una agencia de viajes de lujo, conversando con un agente de viajes que está editando una propuesta.

Debes preservar EXACTAMENTE (nunca inventar ni cambiar):
- nombres propios, personas y destinos
- fechas
- cantidades y número de viajeros
- servicios ya seleccionados (hoteles, traslados, actividades, vuelos, restaurantes, tickets)
- precios, monedas y porcentajes
- políticas y condiciones comerciales existentes (depósitos, cancelaciones, penalidades, reembolsos)

Tienes PROHIBIDO, bajo cualquier circunstancia: inventar o cambiar precios, disponibilidad, servicios, fechas o políticas; afirmar confirmaciones o garantías que no existan en el texto original.

En cada turno recibes: la lista de campos editables de ESTA propuesta (con su clave exacta, etiqueta y texto actual), la conversación previa (si la hay) y el nuevo mensaje del agente.

Tu tarea:
1. Decide a qué campo de la lista se refiere el mensaje. Usa la clave EXACTA tal como aparece en la lista — nunca inventes una clave que no esté en la lista. Si el mensaje no pide modificar ningún campo, o es ambiguo a cuál campo se refiere, usa la clave "none".
2. Si identificaste un campo, redacta de 1 a 3 propuestas de texto de reemplazo para ESE campo siguiendo el pedido del agente (más elegante, más corto, tono luxury, alternativas de título, etc.), basadas EXCLUSIVAMENTE en el texto actual de ese campo. Si el mensaje pide varias alternativas, devuelve varias; si pide un solo resultado, devuelve solo una.
3. Escribe una respuesta conversacional breve (1-2 frases, en español) confirmando qué hiciste o pidiendo la aclaración que falte. Nunca prometas que el cambio ya se aplicó — el agente todavía tiene que elegir y confirmar una opción.

Responde siempre en español.`;

function buildChatUserPrompt(message: string, targets: ChatTarget[], history: ChatTurn[], context?: ChatRequestBody['context']): string {
  const parts: string[] = [];
  parts.push('--- CAMPOS EDITABLES DE ESTA PROPUESTA ---');
  for (const target of targets) {
    parts.push(`clave: "${target.key}" | etiqueta: "${target.label}" | texto actual: "${target.currentText}"`);
  }
  if (context?.destination) {
    parts.push(`\nDestino del viaje (contexto, no lo cambies): ${context.destination}`);
  }
  if (history.length > 0) {
    parts.push('\n--- CONVERSACIÓN PREVIA ---');
    for (const turn of history) {
      parts.push(`${turn.role === 'user' ? 'Agente' : 'Assistant'}: ${turn.content}`);
    }
  }
  parts.push('\n--- NUEVO MENSAJE DEL AGENTE ---');
  parts.push(message);
  return parts.join('\n');
}

function buildChatResponseSchema(targetKeys: string[]) {
  return {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Respuesta conversacional breve en español.' },
      targetKey: {
        type: 'string',
        enum: [...targetKeys, 'none'],
        description: 'Clave EXACTA del campo identificado, tomada de la lista dada, o "none" si no aplica.'
      },
      suggestions: {
        type: 'array',
        items: { type: 'string' },
        description: 'De 0 a 3 propuestas de texto para targetKey. Vacío si targetKey es "none".'
      }
    },
    required: ['reply', 'targetKey', 'suggestions'],
    additionalProperties: false
  };
}

interface ChatAiResult {
  reply: string;
  targetKey: string;
  suggestions: string[];
}

function isValidChatResult(value: unknown, validKeys: string[]): value is ChatAiResult {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.reply !== 'string' || typeof v.targetKey !== 'string') return false;
  if (!Array.isArray(v.suggestions) || !v.suggestions.every((s) => typeof s === 'string')) return false;
  return v.targetKey === 'none' || validKeys.includes(v.targetKey);
}

// ------------------------------------------------------------------
// Manejador del modo chat — separado del handler principal para no mezclar
// la validación/prompt de la ruta legacy (operation+text) con la de chat
// (mensaje libre + lista de campos + historial). Ambos comparten
// autenticación/CORS/timeout, ya resueltos antes de llegar acá.
// ------------------------------------------------------------------
async function handleChatMode(body: ChatRequestBody, json: (body: unknown, status: number) => Response): Promise<Response> {
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) {
    return json({ success: false, error: 'empty_text' }, 400);
  }
  if (message.length > MAX_CHAT_MESSAGE_LENGTH) {
    return json({ success: false, error: 'text_too_long' }, 400);
  }

  const targets = Array.isArray(body.targets)
    ? body.targets.filter(
        (t): t is ChatTarget =>
          !!t && typeof t.key === 'string' && typeof t.label === 'string' && typeof t.currentText === 'string'
      )
    : [];
  if (targets.length === 0) {
    return json({ success: false, error: 'invalid_operation' }, 400);
  }

  const history = Array.isArray(body.history)
    ? body.history
        .filter((h): h is ChatTurn => !!h && (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
        .slice(-MAX_CHAT_HISTORY_TURNS)
    : [];

  const targetKeys = targets.map((t) => t.key);
  const payloadLength =
    message.length + history.reduce((n, h) => n + h.content.length, 0) + targets.reduce((n, t) => n + t.currentText.length, 0);
  if (payloadLength > MAX_CHAT_PAYLOAD_LENGTH) {
    return json({ success: false, error: 'text_too_long' }, 400);
  }

  const context = { destination: typeof body.context?.destination === 'string' ? body.context.destination : undefined };

  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await openai.responses.create(
      {
        model: OPENAI_MODEL,
        input: [
          { role: 'system', content: CHAT_SYSTEM_PROMPT },
          { role: 'user', content: buildChatUserPrompt(message, targets, history, context) }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'proposal_ai_polish_chat',
            schema: buildChatResponseSchema(targetKeys),
            strict: true
          }
        }
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const raw = response.output_text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('proposal-ai-polish (chat): respuesta de OpenAI no es JSON válido');
      return json({ success: false, error: 'malformed_ai_response' }, 502);
    }

    if (!isValidChatResult(parsed, targetKeys)) {
      console.error('proposal-ai-polish (chat): JSON de OpenAI no tiene la forma esperada');
      return json({ success: false, error: 'malformed_ai_response' }, 502);
    }

    return json(
      {
        success: true,
        result: {
          reply: parsed.reply,
          targetKey: parsed.targetKey === 'none' ? null : parsed.targetKey,
          suggestions: parsed.suggestions
        }
      },
      200
    );
  } catch (error) {
    clearTimeout(timeoutId);

    if (controller.signal.aborted) {
      return json({ success: false, error: 'ai_timeout' }, 504);
    }

    const status = (error as { status?: number } | null)?.status;
    console.error('proposal-ai-polish (chat): error llamando a OpenAI', { status, name: (error as Error)?.name });

    if (status === 401 || status === 403) {
      return json({ success: false, error: 'ai_provider_auth_error' }, 502);
    }
    if (status === 429) {
      return json({ success: false, error: 'rate_limited' }, 429);
    }
    if (status && status >= 500) {
      return json({ success: false, error: 'ai_provider_unavailable' }, 502);
    }
    if (error instanceof TypeError) {
      return json({ success: false, error: 'network_failure' }, 502);
    }

    return json({ success: false, error: 'unexpected_error' }, 500);
  }
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  // Preflight se responde antes que cualquier otra cosa, sin tocar auth ni DB.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ success: false, error: 'method_not_allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

  // callerClient corre con la sesión real del usuario (anon key + su JWT) —
  // se usa solo para confirmar quién es y para invocar can_manage_proposals()
  // en su propio contexto. Esta función nunca necesita la service role: no
  // lee ni escribe ninguna tabla, solo llama a OpenAI.
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ success: false, error: 'unauthorized' }, 401);
  }

  const { data: canManage, error: canManageError } = await callerClient.rpc('can_manage_proposals');
  if (canManageError || canManage !== true) {
    return json({ success: false, error: 'forbidden' }, 403);
  }

  const body = (await req.json().catch(() => null)) as RequestBody | ChatRequestBody | null;

  if (isChatBody(body)) {
    return handleChatMode(body, json);
  }
  const legacyBody = body as RequestBody | null;

  if (!isOperation(legacyBody?.operation)) {
    return json({ success: false, error: 'invalid_operation' }, 400);
  }
  const operation = legacyBody!.operation as AiOperation;

  const text = typeof legacyBody?.text === 'string' ? legacyBody.text.trim() : '';
  if (!text) {
    return json({ success: false, error: 'empty_text' }, 400);
  }
  if (text.length > MAX_TEXT_LENGTH) {
    return json({ success: false, error: 'text_too_long' }, 400);
  }

  const context = {
    destination: typeof legacyBody?.context?.destination === 'string' ? legacyBody.context.destination : undefined,
    section: typeof legacyBody?.context?.section === 'string' ? legacyBody.context.section : undefined
  };

  const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await openai.responses.create(
      {
        model: OPENAI_MODEL,
        input: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(operation, text, context) }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'proposal_ai_polish',
            schema: RESPONSE_SCHEMA,
            strict: true
          }
        }
      },
      { signal: controller.signal }
    );

    clearTimeout(timeoutId);

    const raw = response.output_text;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      console.error('proposal-ai-polish: respuesta de OpenAI no es JSON válido');
      return json({ success: false, error: 'malformed_ai_response' }, 502);
    }

    if (!isValidAiResult(parsed)) {
      console.error('proposal-ai-polish: JSON de OpenAI no tiene la forma esperada');
      return json({ success: false, error: 'malformed_ai_response' }, 502);
    }

    return json({ success: true, result: { text: parsed.text, alternatives: parsed.alternatives } }, 200);
  } catch (error) {
    clearTimeout(timeoutId);

    if (controller.signal.aborted) {
      return json({ success: false, error: 'ai_timeout' }, 504);
    }

    // Nunca se devuelve el stack trace ni el mensaje crudo del SDK al
    // cliente (podría filtrar detalles internos) — solo un código estable.
    // Server-side sí se loguea lo mínimo (nombre/status del error), nunca
    // OPENAI_API_KEY, el header Authorization ni el texto de la propuesta.
    const status = (error as { status?: number } | null)?.status;
    console.error('proposal-ai-polish: error llamando a OpenAI', { status, name: (error as Error)?.name });

    if (status === 401 || status === 403) {
      return json({ success: false, error: 'ai_provider_auth_error' }, 502);
    }
    if (status === 429) {
      return json({ success: false, error: 'rate_limited' }, 429);
    }
    if (status && status >= 500) {
      return json({ success: false, error: 'ai_provider_unavailable' }, 502);
    }
    if (error instanceof TypeError) {
      // fetch-level failure (DNS, red caída, etc.)
      return json({ success: false, error: 'network_failure' }, 502);
    }

    return json({ success: false, error: 'unexpected_error' }, 500);
  }
});
