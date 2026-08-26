-- Secciones personalizadas: el admin puede crear secciones nuevas para el
-- Home sin componente público predefinido. Para no tener que ampliar este
-- check constraint cada vez que se crea una, TODAS viven en una sola fila
-- (section_key = 'custom_sections'), cuyo content.sections es un array.
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
        'footer',
        'custom_sections'
      ]
    )
  );

insert into site_content (section_key, content)
values ('custom_sections', '{"sections": []}'::jsonb)
on conflict (section_key) do nothing;
