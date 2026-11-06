-- Reversión de 0057 (caché y coordinación de geocode-place). Solo borra objetos que creó 0057; no toca contenido ni otras funciones.
-- Antes: retira o desactiva la Edge Function geocode-place (si sigue desplegada, sus búsquedas fallarán con un error controlado).
-- Ejecutar a mano (NO es una migración):
--   supabase db query --remote -f supabase/migration-scripts/0057_geocode_cache_rollback.sql   (CLI < 3.0: --linked en vez de --remote)
begin;

drop function if exists public.geocode_cache_purge();
drop function if exists public.geocode_backoff(text, integer);
drop function if exists public.geocode_reserve_slot(text, integer, integer);
drop function if exists public.geocode_release(text, text);
drop function if exists public.geocode_store(text, text, jsonb, integer);
drop function if exists public.geocode_claim(text, text, text, integer);
drop table if exists private.geocode_rate_state;
drop table if exists private.geocode_cache;

commit;
