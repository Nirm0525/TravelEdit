// La conexión directa a Postgres se cierra (sql.end) siempre al terminar la solicitud, con éxito o con error.
export async function closeAfter<D, R>(
  make: () => { deps: D; close(): Promise<void> },
  run: (deps: D) => Promise<R>,
  log: (message: string, meta?: Record<string, unknown>) => void = () => {}
): Promise<R> {
  const { deps, close } = make();
  try {
    return await run(deps);
  } finally {
    try {
      await close();
    } catch (err) {
      log('db.close_failed', { error: (err as Error).message });
    }
  }
}
