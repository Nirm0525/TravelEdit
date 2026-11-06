// Proceso hijo de las pruebas de integración: una «instancia» de la Edge Function como proceso Deno INDEPENDIENTE (su propia
// memoria, su propio mapa de consultas en curso y su propia conexión a PostgreSQL). El proveedor es simulado: nunca hay red.
//
//   deno run -A pg_instance_child.ts <pgUrl> <modo> <archivoDeRegistro> <envJson> <consulta...>
//   modo «record»: registra la hora de cada llamada al proveedor simulado y responde.
//   modo «hang»:   registra «CLAIMED» y deja la llamada al proveedor colgada para siempre (el padre mata el proceso).
import { handleRequest } from './handler.ts';
import { connectAs, fakeGeoapifyBody, fakeNominatimBody, pgDeps } from './pg_deps.ts';

const [url, mode, logFile, envJson, ...queries] = Deno.args;
const client = await connectAs(url!);
const geoapify = JSON.parse(envJson!).GEOCODER_PROVIDER === 'geoapify';
const append = (line: string) => Deno.writeTextFileSync(logFile!, `${line}\n`, { append: true });

const deps = pgDeps(client, {
  env: JSON.parse(envJson!),
  fetch: ((input: Request | URL | string) => {
    const params = new URL(String(input)).searchParams;
    append(`${mode === 'hang' ? 'CLAIMED' : 'CALL'} ${Date.now()} ${params.get('q') ?? params.get('text')}`);
    if (mode === 'hang') {
      return new Promise(() => undefined);
    }
    return Promise.resolve(new Response(geoapify ? fakeGeoapifyBody(String(params.get('text'))) : fakeNominatimBody(String(params.get('q')))));
  }) as typeof fetch
});

const results = await Promise.all(
  queries.map(async (query) => {
    const res = await handleRequest(
      new Request('https://x.test/geocode-place', { method: 'POST', headers: { Authorization: 'Bearer jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }),
      deps
    );
    const body = await res.json();
    return { query, status: res.status, error: body.error ?? null, cached: body.cached ?? null, count: body.results?.length ?? null };
  })
);
append(`DONE ${JSON.stringify(results)}`);
await client.end();
