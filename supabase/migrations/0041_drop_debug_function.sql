-- Limpieza: elimina la función de diagnóstico temporal usada para
-- inspeccionar pg_get_functiondef() en vivo mientras se investigaba el bug
-- corregido en 0040. Nunca formó parte de la arquitectura del producto.
drop function if exists debug_get_function_def(text);
