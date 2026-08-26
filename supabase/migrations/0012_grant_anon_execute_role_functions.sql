-- Bug preexistente encontrado durante el QA de la Fase 3 (no introducido por
-- esa fase): `anon` nunca tuvo permiso EXECUTE sobre is_staff()/can_manage_content(),
-- las funciones security definer que varias políticas RLS usan combinadas con
-- OR junto a una condición pública (p. ej. destinations_select: status='published'
-- OR can_manage_content()). Postgres necesita poder invocar la función aunque
-- la otra rama del OR ya sea verdadera, así que sin este grant cualquier SELECT
-- anónimo sobre esas tablas falla con 42501 — incluso para filas públicas.
-- Este GRANT es puramente aditivo: no cambia ninguna política ni el resultado
-- que ya devuelven estas funciones (is_staff()/can_manage_content() siguen
-- devolviendo false para anon, ya que dependen de auth.uid()), solo permite
-- que anon pueda ejecutarlas para que el OR se resuelva sin error.
grant execute on function is_staff() to anon;
grant execute on function can_manage_content() to anon;
