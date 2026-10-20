// supabase/config.toml decide verify_jwt al desplegar. Estas pruebas evitan que las dos funciones de documentos queden
// con la misma configuración por un descuido:
//  - proposal-documents la llama el cliente de la propuesta privada SIN sesión de Supabase Auth: verify_jwt = false (la
//    propia función valida token + sessionToken + propuesta + estado + expiración + visible_to_client).
//  - proposal-service-files es del admin: debe exigir JWT (sin entrada en config.toml el valor por defecto es true).
import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';

const toml = Deno.readTextFileSync(new URL('../../config.toml', import.meta.url));
const lines = toml.split('\n').map((l) => l.trim()).filter((l) => !l.startsWith('#') && l !== '');

/** Valor de verify_jwt dentro de [functions.<name>], o undefined si la sección no existe / no lo define. */
function verifyJwtOf(name: string): string | undefined {
  const start = lines.indexOf(`[functions.${name}]`);
  if (start < 0) {
    return undefined;
  }
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('[')) {
      break;
    }
    const m = /^verify_jwt\s*=\s*(\w+)/.exec(line);
    if (m) {
      return m[1];
    }
  }
  return undefined;
}

Deno.test('config.toml: proposal-documents es pública (verify_jwt = false), la valida la propia función', () => {
  assertEquals(verifyJwtOf('proposal-documents'), 'false');
});

Deno.test('config.toml: proposal-service-files (admin) exige JWT: sin verify_jwt = false', () => {
  assertFalse(verifyJwtOf('proposal-service-files') === 'false');
  assert(!lines.some((l) => /\[functions\.proposal-service-files\]/.test(l)) || verifyJwtOf('proposal-service-files') === 'true');
});

Deno.test('config.toml: ninguna función de documentos queda abierta por accidente y solo hay una pública nueva', () => {
  const publicOnes = lines.flatMap((l, i) => {
    const m = /^\[functions\.([\w-]+)\]$/.exec(l);
    return m && verifyJwtOf(m[1]) === 'false' ? [m[1]] : [];
  });
  assertEquals(publicOnes.sort(), ['notify-proposal-activity', 'proposal-documents', 'submit-lead']);
});
