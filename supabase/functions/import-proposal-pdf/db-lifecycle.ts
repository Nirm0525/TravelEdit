// Ciclo de vida de la conexión directa a Postgres (postgres.js) por solicitud.
//
// Cada solicitud crea sus dependencias (y su conexión, que es perezosa). La conexión se
// cierra con sql.end():
//  - si la solicitud NO dejó trabajo en segundo plano (404, 403, 409, 429, errores…):
//    al terminar la solicitud;
//  - si dejó trabajo en segundo plano (EdgeRuntime.waitUntil): cuando ese trabajo termina,
//    tenga éxito o falle — nunca antes, porque el proceso sigue usando la conexión después
//    de responder 202.
import type { Deps } from './handler.ts';

export interface RealDeps {
  deps: Deps;
  /** Cierra la conexión (idempotente). */
  close(): Promise<void>;
}

export async function handleWithDbLifecycle(
  req: Request,
  makeDeps: () => RealDeps,
  handle: (req: Request, deps: Deps) => Promise<Response>,
  log: (message: string, meta?: Record<string, unknown>) => void = () => {}
): Promise<Response> {
  const { deps, close } = makeDeps();

  let closing: Promise<void> | null = null;
  const closeOnce = () =>
    (closing ??= close().catch((err) => {
      log('db.close_failed', { error: (err as Error).message });
    }));

  let scheduled = false;
  const wrapped: Deps = {
    ...deps,
    runInBackground(task) {
      deps.runInBackground(
        task
          .catch((err) => {
            log('background.failed', { error: (err as Error).message });
          })
          .finally(closeOnce)
      );
      scheduled = true;
    }
  };

  try {
    return await handle(req, wrapped);
  } finally {
    if (!scheduled) {
      await closeOnce();
    }
  }
}
