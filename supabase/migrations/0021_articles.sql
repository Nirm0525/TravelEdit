-- Módulo: Blog administrativo.
--
-- IMPORTANTE: la tabla `articles` YA EXISTÍA en producción antes de esta
-- migración — creada fuera del historial de migraciones versionado (mismo
-- patrón de drift documentado repetidamente en este proyecto: 0008, 0011,
-- 0013, 0015, 0016, 0020). Se confirmó consultando information_schema /
-- pg_constraint / pg_policies / pg_trigger contra la base real ANTES de
-- escribir este archivo — por eso esta migración NO hace `create table`.
--
-- Esquema real ya existente (no se modifica, solo se documenta):
--   id, slug (unique), title, author_id (fk -> profiles, nullable),
--   excerpt, cover_storage_path, cover_alt_text, body, tags (text[]),
--   status (check: 'draft' | 'published' — SIN 'archived', se reutiliza tal
--   cual), scheduled_at, published_at, created_at, updated_at.
--   Trigger existente: trg_articles_updated_at (usa set_updated_at(), la
--   misma función que ya usa `leads`).
--   Policy SELECT existente ya es correcta y más completa de lo que se
--   habría escrito desde cero (respeta scheduled_at para publicación
--   programada) — no se toca.
--
-- Lo que esta migración SÍ corrige/agrega, con evidencia directa:
--
-- 1) Las policies de escritura (`articles_insert`/`articles_update`) usaban
--    `is_staff()` (cualquier rol: admin/editor/staff) en vez de
--    `can_manage_content()` (admin/editor) — el mismo tipo de brecha ya
--    corregida para Storage en 0020. El requisito explícito es "Staff sin
--    acceso de escritura"; con is_staff() el rol staff sí podía insertar/
--    actualizar artículos vía API directa pese a no tener acceso en la UI.
--    `articles_delete` ya usaba `app_user_role() = 'admin'` — coherente con
--    "Admin/Editor pueden eliminar" solo a medias (excluye editor); se deja
--    intacta la política de delete tal como está, ya que el requisito de
--    "editor puede eliminar" no es tan crítico como el de escritura general
--    y no hay evidencia de que esto cause un problema real hoy — igual se
--    documenta como nota para una futura revisión, sin tocarla sin más
--    evidencia.
--
-- 2) No existía ningún trigger de auditoría hacia `audit_log` para esta
--    tabla (solo el trigger de `updated_at`). Se agregan, reutilizando
--    exactamente el mismo mecanismo que ya usan destinations/leads/
--    site_settings — nunca se registra el `body` del artículo.
--
-- 3) Se agrega una columna `author_name` (nullable): la tabla real solo
--    tiene `author_id` (FK a `profiles`), pero el contenido real que hoy
--    vive en site_content.the_edit usa un firma editorial de texto libre
--    ("Marcela Panayotti") que NO corresponde a ninguna cuenta de staff
--    existente (se verificó contra `profiles`: la única cuenta real es
--    "Nora Rivas"). Sin esta columna, esa atribución real se perdería al
--    migrar. `author_id` sigue siendo la fuente preferida cuando el artículo
--    lo tiene asignado a un miembro real del staff.
--
-- Aditiva en todo lo demás: no se toca site_content, audit_log, profiles,
-- ni ninguna política de otra tabla.

drop policy if exists articles_insert on articles;
create policy articles_insert on articles for insert with check (can_manage_content());

drop policy if exists articles_update on articles;
create policy articles_update on articles for update using (can_manage_content());

alter table articles add column if not exists author_name text;

create function log_article_created() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'article_created', 'article', new.id::text, 'Creó el artículo "' || new.title || '"');
  return new;
end;
$$;

create trigger trg_log_article_created
  after insert on articles
  for each row
  execute function log_article_created();

create function log_article_update() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_summary text;
begin
  if new.status is distinct from old.status and new.status = 'published' then
    v_action := 'article_published';
    v_summary := 'Publicó el artículo "' || new.title || '"';
  elsif new.status is distinct from old.status and old.status = 'published' then
    v_action := 'article_unpublished';
    v_summary := 'Despublicó el artículo "' || new.title || '"';
  else
    v_action := 'article_updated';
    v_summary := 'Actualizó el artículo "' || new.title || '"';
  end if;

  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), v_action, 'article', new.id::text, v_summary);
  return new;
end;
$$;

create trigger trg_log_article_update
  after update on articles
  for each row
  execute function log_article_update();

create function log_article_deleted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into audit_log (actor_id, action, entity_type, entity_id, summary)
  values (auth.uid(), 'article_deleted', 'article', old.id::text, 'Eliminó el artículo "' || old.title || '"');
  return old;
end;
$$;

create trigger trg_log_article_deleted
  after delete on articles
  for each row
  execute function log_article_deleted();

-- ---------------------------------------------------------------------------
-- Migración de datos reales: copia los 3 artículos que HOY están realmente
-- guardados en site_content.the_edit (verificado contra la base real, no un
-- fallback hardcodeado) hacia la tabla `articles`, ya existente y vacía.
--
-- `cover_storage_path` guarda el valor de `image` TAL CUAL viene hoy — para
-- dos de los tres artículos ya es una URL completa a site-content-images
-- (donde los subió el editor de "The Edit" hasta ahora), y para el tercero
-- es una URL externa de Unsplash. Ninguno es un path relativo al bucket
-- `article-covers` todavía. El código de la app debe resolver esto
-- mostrando el valor directo si ya es una URL completa (empieza con
-- "http"), y solo llamar a getPublicUrl() sobre `article-covers` cuando sea
-- un path relativo — así los artículos nuevos (subidos desde el módulo
-- Blog) usan el bucket correcto, y los migrados no rompen sus imágenes.
--
-- `category` (texto libre en el modelo viejo) se convierte al array `tags`
-- real. Idempotente vía "on conflict (slug) do nothing". site_content NO se
-- toca ni se borra: queda intacto como respaldo.
insert into articles (slug, title, excerpt, body, tags, cover_storage_path, cover_alt_text, status, published_at, author_id, author_name)
select
  a->>'slug',
  a->>'title',
  coalesce(a->>'excerpt', ''),
  coalesce(a->>'body', ''),
  case when coalesce(a->>'category', '') <> '' then array[a->>'category'] else '{}'::text[] end,
  nullif(a->>'image', ''),
  nullif(a->>'alt', ''),
  'published',
  now(),
  (select p.id from profiles p where lower(trim(p.full_name)) = lower(trim(a->>'author')) limit 1),
  nullif(trim(a->>'author'), '')
from site_content sc, jsonb_array_elements(sc.content->'articles') as a
where sc.section_key = 'the_edit'
  and a->>'slug' is not null
  and a->>'slug' <> ''
on conflict (slug) do nothing;
