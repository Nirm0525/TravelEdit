// Edge Function: import-proposal-pdf
//
// Entrada: POST { import_id } con el JWT del usuario. Lee el PDF ya subido a
// Storage, lo envía a OpenAI (API Responses, salida estructurada estricta) y guarda
// el resultado (y, en modo merge, el diff contra la propuesta) en
// proposal_imports. Nunca escribe en proposals.
//
// Secrets: OPENAI_API_KEY (obligatorio; el mismo que usa proposal-ai-polish),
// OPENAI_MODEL (opcional, por defecto gpt-6.1-sol), OPENAI_PDF_DETAIL (auto|low|high,
// por defecto high), OPENAI_REASONING_EFFORT (none|minimal|low|medium|high|off; por
// defecto el más bajo que el modelo acepte), OPENAI_MAX_OUTPUT_TOKENS (por defecto
// 40000), ALLOWED_ORIGINS (opcional, lista separada por comas con los dominios del
// admin), PDF_MAX_PAGES (opcional, por defecto 100), PROCESS_DEADLINE_MS (opcional,
// plazo total del proceso; por defecto 140000).
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_DB_URL
// los inyecta Supabase.
import { handleWithDbLifecycle } from './db-lifecycle.ts';
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';

// La conexión directa a Postgres se cierra (sql.end) al terminar la solicitud o, si dejó trabajo
// en segundo plano, al terminar ese trabajo.
Deno.serve((req) =>
  handleWithDbLifecycle(req, createRealDeps, handleRequest, (message, meta) => console.log(JSON.stringify({ msg: message, ...meta })))
);
