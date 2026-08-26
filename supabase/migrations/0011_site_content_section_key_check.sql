-- El check constraint real de site_content.section_key ('hero','about','contact',
-- 'social') no está documentado en ninguna migración committeada — otra
-- divergencia entre el historial de migraciones y la base real, como la ya
-- señalada en 0008 para section_key/content. Se amplía (solo se agregan
-- valores, no se quita ninguno) para permitir las secciones nuevas de la
-- Fase 3 del CMS de la página principal.
alter table site_content drop constraint if exists site_content_section_key_check;

alter table site_content add constraint site_content_section_key_check
  check (
    section_key = any (
      array[
        'hero',
        'about',
        'contact',
        'social',
        'destinos_destacados',
        'travel_process',
        'experiencias',
        'the_edit',
        'cta_final',
        'footer'
      ]
    )
  );
