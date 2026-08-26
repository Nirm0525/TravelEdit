-- La tabla leads en remoto quedó sin la columna `details` definida en
-- 0003_leads.sql (drift: las migraciones se aplicaron manualmente en algún
-- momento, antes de que 0003 incluyera esta columna). submit-lead siempre
-- inserta en `details`, así que sin esto ningún envío del formulario público
-- podía guardarse.
alter table leads add column if not exists details jsonb not null default '{}';
