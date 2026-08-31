-- articles.body debe escribirse solo vía save-rich-content (service role,
-- sanea con sanitize-html) — exactamente el mismo modelo que
-- destinations.long_description (revoke update en 0002_destinations.sql).
-- El comentario original de save-rich-content ya asumía este revoke para
-- articles.body, pero nunca quedó como migración — se agrega aquí junto con
-- el fix del lado Angular (ArticlesService/BlogEditor dejaron de mandar
-- `body` en el insert/update directo). Sin este revoke, `authenticated`
-- podía seguir escribiendo HTML sin sanear directo en la columna.
revoke update (body) on articles from authenticated;
