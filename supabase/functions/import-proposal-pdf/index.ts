// Edge Function: import-proposal-pdf
//
// Entrada: POST { import_id } con el JWT del usuario. Lee el PDF ya subido a
// Storage, lo envía a Anthropic con una herramienta de extracción estructurada
// y guarda el resultado (y, en modo merge, el diff contra la propuesta) en
// proposal_imports. Nunca escribe en proposals.
//
// Secrets: ANTHROPIC_API_KEY (obligatorio), ANTHROPIC_MODEL (opcional, por
// defecto claude-sonnet-5-5), ALLOWED_ORIGINS (opcional, lista separada por
// comas con los dominios del admin), PDF_MAX_PAGES (opcional, por defecto 100).
// SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_DB_URL
// los inyecta Supabase.
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';

Deno.serve((req) => handleRequest(req, createRealDeps()));
