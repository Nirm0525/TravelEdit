// Edge Function: proposal-service-files (admin)
//
// Documentos adjuntos por servicio del itinerario: autoriza y finaliza subidas directas a Storage (bucket PRIVADO
// proposal-service-files), cambia su visibilidad, los borra, entrega URLs firmadas de lectura y borra servicios/días
// con sus documentos de forma coherente. Entrada: POST { action, ... } con el JWT del usuario. Ver handler.ts.
//
// Secrets: ALLOWED_ORIGINS (opcional). SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';

Deno.serve((req) => handleRequest(req, createRealDeps()));
