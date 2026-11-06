-- Reversión de 0058 (límite diario de geocode-place). Solo borra lo que creó 0058; no toca 0057 ni contenido.
-- Antes: retira o desactiva la versión de geocode-place que usa el límite diario (si sigue desplegada, sus búsquedas nuevas fallarán con un
-- error controlado hasta que se redespliegue la versión anterior).
-- Ejecutar a mano (NO es una migración):
--   supabase db query --remote -f supabase/migration-scripts/0058_geocode_daily_quota_rollback.sql   (CLI < 3.0: --linked en vez de --remote)
-- Si 0058 se registró en el historial: supabase migration repair --status reverted 0058 --remote
begin;

drop function if exists public.geocode_quota_take(text, integer, boolean);
drop table if exists private.geocode_daily_usage;

commit;
