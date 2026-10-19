import { assertEquals, assertRejects } from 'jsr:@std/assert@1';
import { closeAfter } from './lifecycle.ts';

function probe(closeImpl: () => Promise<void> = () => Promise.resolve()) {
  const events: string[] = [];
  return {
    events,
    make: () => ({
      deps: 'deps',
      close: () => {
        events.push('close');
        return closeImpl();
      }
    })
  };
}

Deno.test('conexión: se cierra al terminar con éxito', async () => {
  const p = probe();
  assertEquals(await closeAfter(p.make, (d) => Promise.resolve(`ok:${d}`)), 'ok:deps');
  assertEquals(p.events, ['close']);
});

Deno.test('conexión: se cierra también cuando el manejador lanza un error', async () => {
  const p = probe();
  await assertRejects(() => closeAfter(p.make, () => Promise.reject(new Error('boom'))), Error, 'boom');
  assertEquals(p.events, ['close']);
});

Deno.test('conexión: si cerrar falla, se registra y no rompe la respuesta', async () => {
  const logs: string[] = [];
  const p = probe(() => Promise.reject(new Error('end falló')));
  assertEquals(await closeAfter(p.make, () => Promise.resolve(1), (m) => void logs.push(m)), 1);
  assertEquals(logs, ['db.close_failed']);
});
