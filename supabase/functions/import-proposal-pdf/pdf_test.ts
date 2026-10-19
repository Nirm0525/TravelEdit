import { assertEquals, assertThrows } from 'jsr:@std/assert@1';
import { estimatePageCount, MAX_PDF_BYTES, toBase64, UserError, validatePdf } from './pdf.ts';

const enc = (s: string) => new TextEncoder().encode(s);

function fakePdf(pages: number, extra = ''): Uint8Array {
  let body = '%PDF-1.7\n';
  for (let i = 0; i < pages; i++) {
    body += `${i + 1} 0 obj\n<< /Type /Page /Parent 99 0 R >>\nendobj\n`;
  }
  body += `99 0 obj\n<< /Type /Pages /Count ${pages} >>\nendobj\n${extra}%%EOF`;
  return enc(body);
}

Deno.test('pdf: un PDF válido pasa y se cuentan las páginas', () => {
  assertEquals(validatePdf(fakePdf(3)).pages, 3);
});

Deno.test('pdf: un archivo que no es PDF se rechaza por los primeros bytes (no por la extensión)', () => {
  const error = assertThrows(() => validatePdf(enc('<html>no soy un pdf</html>')), UserError);
  assertEquals(error.message, 'El archivo no es un PDF válido.');
  assertThrows(() => validatePdf(new Uint8Array(0)), UserError, 'no es un PDF');
});

Deno.test('pdf: más de 20 MB se rechaza con un mensaje claro', () => {
  const big = new Uint8Array(MAX_PDF_BYTES + 1);
  big.set(enc('%PDF-1.7'));
  assertThrows(() => validatePdf(big), UserError, '20 MB');
});

Deno.test('pdf: más páginas que el límite de Anthropic se rechaza antes de llamar a la API', () => {
  assertThrows(() => validatePdf(fakePdf(101)), UserError, '101 páginas');
  assertEquals(validatePdf(fakePdf(100)).pages, 100);
  assertEquals(validatePdf(fakePdf(150), 600).pages, 150);
});

Deno.test('pdf: un PDF cifrado se rechaza', () => {
  assertThrows(() => validatePdf(fakePdf(1, 'trailer << /Encrypt 12 0 R >>\n')), UserError, 'contraseña');
});

Deno.test('pdf: si no se puede contar páginas (objetos comprimidos) no se bloquea', () => {
  assertEquals(estimatePageCount(enc('%PDF-1.7\nstream...endstream')), null);
  assertEquals(validatePdf(enc('%PDF-1.7\nstream...endstream')).pages, null);
});

Deno.test('pdf: base64 de bytes grandes', () => {
  const bytes = new Uint8Array(100_000).fill(65);
  assertEquals(atob(toBase64(bytes)).length, 100_000);
});
