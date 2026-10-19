import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { handleWithDbLifecycle, type RealDeps } from './db-lifecycle.ts';
import type { Deps } from './handler.ts';

interface Probe {
  events: string[];
  makeDeps: () => RealDeps;
  /** Tareas entregadas a runInBackground (lo que EdgeRuntime.waitUntil recibiría). */
  waitUntil: Promise<unknown>[];
}

function probe(closeImpl: () => Promise<void> = () => Promise.resolve()): Probe {
  const events: string[] = [];
  const waitUntil: Promise<unknown>[] = [];
  const deps = {
    runInBackground: (task: Promise<unknown>) => void waitUntil.push(task)
  } as unknown as Deps;
  return {
    events,
    waitUntil,
    makeDeps: () => ({
      deps,
      close: () => {
        events.push('close');
        return closeImpl();
      }
    })
  };
}

const req = () => new Request('https://x.test/', { method: 'POST' });

Deno.test('conexión: sin trabajo en segundo plano (404/403/409/429…) se cierra al terminar la solicitud', async () => {
  const p = probe();
  const res = await handleWithDbLifecycle(req(), p.makeDeps, () => Promise.resolve(new Response(null, { status: 404 })));
  assertEquals(res.status, 404);
  assertEquals(p.events, ['close']);
});

Deno.test('conexión: si el manejador lanza un error, también se cierra', async () => {
  const p = probe();
  await assertRejects(() => handleWithDbLifecycle(req(), p.makeDeps, () => Promise.reject(new Error('boom'))), Error, 'boom');
  assertEquals(p.events, ['close']);
});

Deno.test('conexión: con trabajo en segundo plano NO se cierra al responder, sino al terminar el trabajo (éxito)', async () => {
  const p = probe();
  let finishWork!: () => void;
  const work = new Promise<void>((resolve) => (finishWork = resolve));
  const res = await handleWithDbLifecycle(req(), p.makeDeps, (_req, deps) => {
    deps.runInBackground(work.then(() => void p.events.push('trabajo terminado')));
    return Promise.resolve(new Response(null, { status: 202 }));
  });
  assertEquals(res.status, 202);
  assertEquals(p.events, []); // la solicitud ya respondió, pero la conexión sigue abierta para el proceso
  finishWork();
  await Promise.all(p.waitUntil);
  assertEquals(p.events, ['trabajo terminado', 'close']);
});

Deno.test('conexión: si el trabajo en segundo plano falla, también se cierra (y el error no queda sin manejar)', async () => {
  const p = probe();
  const logs: string[] = [];
  await handleWithDbLifecycle(
    req(),
    p.makeDeps,
    (_req, deps) => {
      deps.runInBackground(Promise.reject(new Error('falló el proceso')));
      return Promise.resolve(new Response(null, { status: 202 }));
    },
    (message) => void logs.push(message)
  );
  await Promise.all(p.waitUntil); // no debe rechazar
  assertEquals(p.events, ['close']);
  assertEquals(logs, ['background.failed']);
});

Deno.test('conexión: se cierra una sola vez aunque haya varias tareas o salidas', async () => {
  const p = probe();
  await handleWithDbLifecycle(req(), p.makeDeps, (_req, deps) => {
    deps.runInBackground(Promise.resolve());
    deps.runInBackground(Promise.resolve());
    return Promise.resolve(new Response(null, { status: 202 }));
  });
  await Promise.all(p.waitUntil);
  assertEquals(p.events, ['close']);
});

Deno.test('conexión: si cerrar falla, se registra y no rompe la respuesta', async () => {
  const logs: string[] = [];
  const p = probe(() => Promise.reject(new Error('end falló')));
  const res = await handleWithDbLifecycle(
    req(),
    p.makeDeps,
    () => Promise.resolve(new Response(null, { status: 409 })),
    (message) => void logs.push(message)
  );
  assertEquals(res.status, 409);
  assertEquals(logs, ['db.close_failed']);
  assert(p.events.includes('close'));
});
