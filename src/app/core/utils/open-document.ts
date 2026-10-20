/**
 * Para ABRIR un documento en una pestaña (no descargarlo) se baja primero y se abre como blob: del propio sitio.
 *
 * Por qué: Supabase Storage sirve cada archivo con una política de seguridad restrictiva (CSP con `sandbox`) para que un
 * archivo subido nunca pueda ejecutar código. Con esa política el visor de PDF del navegador queda bloqueado y la pestaña se
 * ve en blanco. Un blob: creado por esta página no lleva esa política y el visor funciona. El tipo del blob es el que el
 * servidor ya validó con los primeros bytes del archivo (PDF, JPEG, PNG o WebP).
 *
 * Si no se puede bajar (red, CORS), se devuelve la URL firmada tal cual y la pestaña la abre directo: peor visor, pero
 * nunca se queda sin abrir.
 */
export interface ViewableUrlDeps {
  fetch?: typeof fetch;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  schedule?: (fn: () => void, ms: number) => void;
}

/** Cuánto vive el blob: tiempo de sobra para que el visor lo cargue (no es un enlace que se comparta). */
export const BLOB_URL_LIFETIME_MS = 10 * 60 * 1000;

export async function resolveViewableUrl(signedUrl: string, mimeType: string, deps: ViewableUrlDeps = {}): Promise<string> {
  const doFetch = deps.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const create = deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const revoke = deps.revokeObjectURL ?? ((url: string) => URL.revokeObjectURL(url));
  const schedule = deps.schedule ?? ((fn: () => void, ms: number) => void setTimeout(fn, ms));
  try {
    const res = await doFetch(signedUrl);
    if (!res.ok) {
      throw new Error(`http ${res.status}`);
    }
    const blobUrl = create(new Blob([await res.blob()], { type: mimeType }));
    schedule(() => revoke(blobUrl), BLOB_URL_LIFETIME_MS);
    return blobUrl;
  } catch {
    return signedUrl;
  }
}
