// Edge Function: proposal-documents (cliente, propuesta privada)
//
// Entrega al cliente los documentos de un servicio marcados como visibles: lista (sin rutas de Storage) y URL firmada
// de 10 minutos bajo demanda. Sin JWT de usuario (verify_jwt = false en config.toml, como notify-proposal-activity):
// el acceso lo valida handler.ts con token + sessionToken. Ver handler.ts.
//
// Secrets: ALLOWED_ORIGINS (opcional). SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';

Deno.serve((req) => handleRequest(req, createRealDeps()));
