-- profiles_select (0001_auth.sql) solo dejaba ver el propio perfil o, si eras
-- admin, todos. Eso rompe "quién escribió qué" en las notas de leads: un
-- editor no podía resolver el nombre de un compañero admin (o viceversa).
-- Ver el nombre de otro miembro del staff no es sensible — lo que sigue
-- restringido es poder editar/borrar perfiles ajenos.

drop policy profiles_select on profiles;

create policy profiles_select on profiles for select
  using (auth.uid() = id or is_staff());
