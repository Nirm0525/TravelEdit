# Retención del PDF importado (pendiente — NO implementado)

Decisión: el PDF contiene datos del cliente, así que no se guarda más de lo necesario.

1. **Al aplicar la importación (Fase 3):** se borra el objeto del bucket `proposal-imports`.
2. **Importaciones que nunca se aplican:** se borran a los 30 días de `created_at`
   (estados `uploaded`, `processing`, `ready` y `failed`).

## Dónde ejecutarlo (propuesta)

- **Borrado en el momento de aplicar:** dentro de `apply-proposal-import` (Edge Function, Fase 3),
  *después* de que la transacción de SQL confirme. Se hace con la API de Storage
  (`storage.from('proposal-imports').remove([path])`) usando la service role. Si el borrado falla, la
  importación ya está aplicada: se registra y el barrido diario lo reintenta.
- **Barrido de 30 días:** `pg_cron` (un trabajo diario) que llama con `pg_net` a una Edge Function
  programada `purge-proposal-imports` (la clave de servicio, en Supabase Vault). La función:
  1. selecciona las importaciones sin aplicar con `created_at < now() - interval '30 days'`
     (y las aplicadas cuyo objeto siga en el bucket);
  2. borra los objetos con la API de Storage;
  3. limpia `extracted` y `diff` (también contienen datos del cliente) y marca la fila
     (p. ej. `file_deleted_at`), conservando solo lo mínimo para auditoría.

Por qué no solo SQL: borrar filas de `storage.objects` con SQL deja el archivo en el almacenamiento
de fondo; los objetos deben borrarse con la API de Storage.

## Pendiente de decidir

- Si `extracted` / `diff` de las importaciones aplicadas se conservan o se limpian al aplicar.
- Una columna `file_deleted_at` (migración nueva) para que el barrido sea idempotente.
