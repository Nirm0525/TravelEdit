-- Endurecimiento de privilegios de tabla (no toca RLS ni EXECUTE de funciones).
--
-- Contexto: anon y authenticated tenían privilegios de tabla de sobra
-- (DELETE/TRUNCATE para anon en leads, lead_notes, profiles, site_settings…).
-- RLS evita el uso normal, pero TRUNCATE no pasa por RLS. Las solicitudes
-- públicas ya entran por la edge function submit-lead (service_role), así que
-- anon no necesita tocar esas tablas.
--
-- anon: solo SELECT, y solo en el contenido público (las policies *_select_public
-- ya limitan a lo publicado). Nada sobre leads, lead_notes, profiles ni site_settings.
-- authenticated: se retiran los privilegios estructurales (TRUNCATE, TRIGGER,
-- REFERENCES) que ninguna policy contempla, e INSERT en profiles (sin policy de
-- inserción: el perfil lo crea el trigger handle_new_user).
--
-- Reversión: ver 0048_harden_table_privileges_rollback.sql.

-- anon: retirar todo en las tablas internas
revoke all on public.leads, public.lead_notes, public.profiles, public.site_settings from anon;

-- anon: contenido público, solo lectura
revoke all on public.articles, public.destinations, public.destination_images,
              public.itinerary_days, public.site_content from anon;
grant select on public.articles, public.destinations, public.destination_images,
                public.itinerary_days, public.site_content to anon;

-- authenticated: sin privilegios estructurales en ninguna tabla de public
revoke truncate, trigger, references on all tables in schema public from authenticated;

-- authenticated: profiles no tiene policy de INSERT
revoke insert on public.profiles from authenticated;
