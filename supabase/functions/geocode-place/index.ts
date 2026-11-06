// Edge Function: geocode-place (admin)
//
// Busca un lugar con Geoapify (datos de OpenStreetMap) para ofrecerlo como ubicación de un día o servicio. Ver handler.ts y README.md.
// Autenticación: JWT de una usuaria con can_manage_proposals() (verify_jwt queda en su valor por defecto: true).
//
// Secret OBLIGATORIO: GEOAPIFY_API_KEY (solo en el servidor; nunca se registra ni se guarda). Sin ella no se llama a nadie.
// Secrets opcionales: GEOCODER_PROVIDER (geoapify; nominatim solo si se elige explícitamente, sin respaldo automático), GEOCODER_DAILY_LIMIT (500),
//   GEOCODER_MIN_INTERVAL_MS (1100; Geoapify no baja de 1000), GEOCODER_BASE_URL, GEOCODER_LANGUAGE (es), GEOCODER_TIMEOUT_MS (8000),
//   GEOCODER_CACHE_DAYS (30), GEOCODER_EMPTY_CACHE_HOURS (24), GEOCODER_CONTACT_EMAIL, GEOCODER_USER_AGENT, ALLOWED_ORIGINS.
// SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los inyecta Supabase.
import { handleRequest } from './handler.ts';
import { createRealDeps } from './supabase-deps.ts';

Deno.serve((req) => handleRequest(req, createRealDeps()));
