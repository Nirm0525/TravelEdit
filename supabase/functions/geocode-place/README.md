# geocode-place

Busca un lugar para ofrecerlo como ubicación de un día o servicio. Autenticada (JWT + `can_manage_proposals()`), con caché persistente,
turno global de 1 petición/s y **límite diario persistente de llamadas externas**, todo coordinado entre instancias en la base.
Proveedor por defecto: **Geoapify** (datos de OpenStreetMap). Migraciones: `0057_geocode_cache.sql` (caché y turno) y `0058_geocode_daily_quota.sql` (límite diario).

La asesora escribe un lugar, pulsa «Buscar ubicación», elige uno de hasta 3 resultados, lo confirma y guarda. Sin copiar HTML. Al recargar un
documento se usa la ubicación guardada: nunca se vuelve a geocodificar. No hay llamadas de IA en esta búsqueda.

## Secrets

| Secret | Obligatorio | Predeterminado | Notas |
|---|---|---|---|
| `GEOAPIFY_API_KEY` | **Sí** | — | Solo existe como secret del servidor: nunca se registra, nunca llega al navegador ni a los documentos. Sin clave (o con una de forma inválida) la función responde `provider_not_configured` y **no llama a nadie ni consume cuota**. |
| `GEOCODER_PROVIDER` | No | `geoapify` | `nominatim` solo si se elige explícitamente. **No hay respaldo automático** entre proveedores. |
| `GEOCODER_DAILY_LIMIT` | No | `500` (1–3000) | Máximo de llamadas externas por día UTC, compartido entre instancias. |
| `GEOCODER_MIN_INTERVAL_MS` | No | `1100` | **Geoapify nunca baja de 1000** (1 petición/s), pongas lo que pongas. |
| `GEOCODER_BASE_URL` | No | URL oficial del proveedor | Debe ser https. Cambiarla usa caché, turno y límite diario distintos. |
| `GEOCODER_LANGUAGE` | No | `es` | Idioma de los resultados (para Geoapify, las 2 primeras letras: ISO 639-1); forma parte de la clave de caché. |
| `GEOCODER_TIMEOUT_MS`, `GEOCODER_CACHE_DAYS`, `GEOCODER_EMPTY_CACHE_HOURS`, `GEOCODER_USER_AGENT`, `GEOCODER_CONTACT_EMAIL`, `ALLOWED_ORIGINS` | No | 8000 ms, 30 días, 24 h, … | Ver `index.ts`. |

No hay que activar facturación, suscripciones ni recargas: el plan gratuito de Geoapify no pide tarjeta («No credit card required») y esta integración
se detiene sola a las 500 llamadas diarias, muy por debajo de sus 3.000 créditos/día. Cada geocodificación cuesta 1 crédito.

## Autocompletado (sugerencias al escribir)

Mismo endpoint, `POST { query, mode: 'autocomplete', bias?: { lat, lon } }` (sin `mode` = búsqueda completa de siempre).

- **Proveedor:** `GET /v1/geocode/autocomplete` de Geoapify (endpoint oficial). Devuelve hasta 5 sugerencias con nombre, dirección, ciudad y país **y sus coordenadas**: elegir una **no** requiere otra llamada (no hay endpoint de detalles que contar). Nominatim **no** ofrece autocompletado (su política lo prohíbe): responde `autocomplete_unsupported`.
- **Cuándo se consulta (navegador):** solo cuando la asesora escribe (evento `input`), desde 4 caracteres y tras 700 ms sin teclear. Nunca al abrir el editor, cargar el documento, rellenar el campo desde datos guardados ni al enfocar. El servidor también exige 4 caracteres.
- **Preferencia geográfica:** `bias=proximity:lon,lat` (preferencia, **nunca un filtro por país**) solo con coordenadas ya guardadas del día/servicio; se redondean a 0,1° (~11 km). Sin lugar guardado no se envía nada y la ciudad/país del día ya van en el texto precargado.
- **Caché:** otra familia de claves — `v3|ac5|<idioma>|prox:<lat>,<lon>|<consulta>` (endpoint, límite de sugerencias, idioma, preferencia y consulta). Las búsquedas completas siguen en `v2|<idioma>|<consulta>`. Nunca se mezclan.
- **Cuota y ritmo:** la MISMA cuota diaria de 500 intentos externos (UTC) y el MISMO turno global de 1 petición/s que la búsqueda y entre instancias; los aciertos de caché no consumen. Las sugerencias esperan como máximo 1,5 s de turno (si no cabe, `busy`).
- **Cancelación:** el navegador cancela con `AbortController` y descarta respuestas obsoletas, pero **eso no evita** la llamada que el servidor ya hubiera enviado al proveedor: esa cuenta en la cuota.
- **Pausas:** con `quota_exhausted` o pausa del proveedor, la interfaz detiene las sugerencias el tiempo indicado; «Buscar ubicación» sigue disponible (sirve la caché, y las consultas nuevas reciben el aviso).

## Cómo funciona el control del plan gratuito

- **Límite diario (0058):** `geocode_quota_take(ámbito, límite, consumir)` comprueba y consume en UNA sentencia (`INSERT … ON CONFLICT DO UPDATE … WHERE calls < límite`): ni con cientos de conexiones a la vez supera el límite. El día es UTC (se renueva a las 00:00 UTC).
- **Se cuenta cada intento externo**, incluidos errores, timeouts y rechazos (se consume justo antes de llamar). Los aciertos de caché y los rechazos por límite o por pausa **no** consumen.
- **Al agotarse:** se sirven las ubicaciones cacheadas; las búsquedas nuevas reciben `quota_exhausted` (HTTP 429) con la hora de renovación y **no se llama al proveedor**. La interfaz avisa sin desactivar el botón (lo ya buscado sigue funcionando).
- **Ritmo:** 1 petición por segundo para todas las instancias (turno en la base); lo que no cabe en 4 s de cola recibe «ocupado» sin llegar al proveedor.
- **Pausas:** ante 429/401/402/403/503 del proveedor se pausa a todas las instancias; se respeta `Retry-After` entero (hasta 1 año); sin él, 120 s (429), 300 s (403), 600 s (401), 3600 s (402), 60 s (503). Sin reintentos automáticos.
- **Caché:** persistente, separada por proveedor + endpoint + idioma + versión de formato; rotar la clave de API **no** la invalida (la clave no forma parte del ámbito).

## Qué se guarda y qué se muestra

Al guardar, el lugar elegido se guarda **estructurado** (coordenadas, `bbox`, y su procedencia: `geocoder`, `placeId`, `dataSource`, `attribution`, `license`) dentro de `mapLocation.place`; la URL del mapa se construye en código. **No se supone que todo resultado tenga identificador OSM:** `osmType`/`osmId` solo existen si el proveedor los informó (Geoapify no los garantiza). Los mapas de Google y los lugares de OpenStreetMap guardados antes siguen funcionando igual.

Junto al mapa (editor, vista previa y página del viajero) se muestra «© OpenStreetMap contributors» y, si lo geocodificó Geoapify, «Powered by Geoapify» (atribución obligatoria del plan gratuito, además de la de OpenStreetMap).

## Cómo se prueba

```
# 1) Unitarias de la función y de los adaptadores + migración 0057 en PGlite (sin base)
deno test -A supabase/functions/geocode-place/handler_test.ts supabase/functions/geocode-place/nominatim_test.ts \
  supabase/functions/geocode-place/geoapify_test.ts supabase/functions/geocode-place/handler_geoapify_test.ts   supabase/functions/geocode-place/handler_autocomplete_test.ts \
  supabase/functions/_shared/geocode_cache_migration_test.ts

# 2) Integración contra PostgreSQL REAL (varias conexiones y procesos Deno independientes; el proveedor SIEMPRE simulado)
GEOCODE_TEST_PG_URL=postgres://postgres:postgres@127.0.0.1:55432/geo deno test -A supabase/functions/geocode-place/postgres_concurrency_test.ts
```

La segunda se omite sin `GEOCODE_TEST_PG_URL` y **se niega a correr** si la base no se llama `geo` o `*_geocode_test` (borra y recrea los objetos `geocode_*`).
Usa un PostgreSQL desechable; nunca la base de producción.

### Resultado de la verificación (PostgreSQL 18.6 real)
Concurrencia y recuperación de 0057 (varias conexiones, procesos Deno separados, instancias interrumpidas, bloqueos, vencimientos), más:

- **0058:** 80 conexiones consumen a la vez con límite 25 → exactamente 25 permitidas (cada una con un número distinto) y la tabla queda en 25. Cambio de día (el consumo de ayer no cuenta hoy, limpieza de más de 7 días), valores absurdos acotados, permisos (solo `service_role`) y «ocupado» (falla cerrado) con la fila retenida por otra transacción.
- **Geoapify de extremo a extremo:** 6 búsquedas nuevas simultáneas desde 3 instancias con límite 3 → exactamente 3 llamadas al proveedor, espaciadas ≥ 1 s; lo mismo con 3 procesos Deno separados; los errores (500, red caída) cuentan; con el límite agotado se sirve lo cacheado y lo nuevo recibe `quota_exhausted` sin llamar; al día siguiente (simulado) vuelve a funcionar.
- **Clave:** nunca aparece en respuestas, logs ni caché (incluso si el proveedor la repite en un error).

### Qué NO se pudo comprobar sin clave real
- La forma exacta de la respuesta real de Geoapify y de sus errores (la documentación oficial no documenta `bbox` ni los códigos de error: el adaptador los trata de forma defensiva).
- Que el plan gratuito sirva desde la infraestructura de Supabase sin restricciones, y las condiciones de caché/almacenamiento: los términos de Geoapify no los tratan expresamente (su página de productos dice que los resultados se pueden «cache, store, and redistribute», pero no está en los términos). **Antes de usarlo en producción de forma sostenida, confírmalo por escrito con Geoapify**, igual que el uso comercial en producción («con algunas limitaciones» sin definir).

## Aplicar 0058 y desplegar (nada se ejecuta desde este repositorio)

Comprobado con la CLI oficial 3.0.0 (`supabase` no está en el PATH de esta máquina): `db query` usa `--remote` (`--linked` está obsoleto, se retirará en v4; sin ninguno apunta a la base **local**). **No uses `migration up` ni `db push`** (el historial remoto está incompleto: 0043–0056 nunca se registraron).

```
supabase --version
supabase migration list --remote                                    # solo lectura: anota el estado
supabase db query --remote -f supabase/migrations/0058_geocode_daily_quota.sql
supabase db query --remote --read-only -f supabase/migration-scripts/0058_geocode_daily_quota_verify.sql   # 6 filas con ok = true
supabase migration repair --status applied 0058 --remote           # SOLO tras la verificación; añade únicamente la versión 0058
supabase migration list --remote                                    # 0058 debe aparecer; el resto igual que antes
```
Si `db query -f` falla con varias sentencias, pega el archivo en el SQL Editor del panel y continúa con la verificación y el `repair`.
Reversión (a mano): `supabase/migration-scripts/0058_geocode_daily_quota_rollback.sql` y, si se registró, `supabase migration repair --status reverted 0058 --remote`.

### Configurar la clave y hacer UNA prueba real
1. Crea la clave en tu cuenta gratuita de Geoapify (sin tarjeta). Guárdala **sin escribirla en el historial de la terminal**: crea un archivo temporal `.env.geo` FUERA del repositorio con una sola línea `GEOAPIFY_API_KEY=…` y ejecuta `supabase secrets set --env-file <ruta>/.env.geo --remote`; después bórralo.
2. Despliega la función: `supabase functions deploy geocode-place --use-api --remote` (JWT activo; no pases `--no-verify-jwt`). Orden: 0058 → clave → función → frontends.
3. Prueba única: en el admin, con un itinerario de prueba, añade ubicación al Día 1, escribe `torre de belem, lisboa`, pulsa «Buscar ubicación» **una vez**, elige, confirma y (si quieres) guarda. Debe mostrar 1–3 resultados con «Powered by Geoapify».
4. Comprobación (solo lectura): `supabase db query --remote --read-only "select scope, day, calls from private.geocode_daily_usage"` → 1 llamada hoy; y la fila `ready` en `private.geocode_cache`. Una segunda búsqueda igual no suma llamadas.
