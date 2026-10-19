// Edge Function: apply-proposal-import (modo "new")
//
// Entrada: POST { import_id, origin_channel, lead_id? } con el JWT del usuario. Crea una propuesta en
// BORRADOR a partir de lo extraído por import-proposal-pdf (importación en 'ready'), en una sola
// transacción, y borra el PDF del bucket. El modo "merge" no está implementado.
//
// Secrets: ALLOWED_ORIGINS (opcional, dominios del admin separados por comas). SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY y SUPABASE_DB_URL los inyecta Supabase.
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';
import { closeAfter } from './lifecycle.ts';

Deno.serve((req) => closeAfter(createRealDeps, (deps) => handleRequest(req, deps)));
