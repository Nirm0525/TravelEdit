// Los errores de envío de email pueden venir de un SDK/API externo (Resend) y
// en teoría incluir fragmentos de headers, API keys o tokens en el mensaje.
// Antes de mostrarlos en el panel se redactan los patrones que suelen delatar
// un secreto, aunque la vista sea solo para staff autenticado.
const SECRET_PATTERNS: RegExp[] = [
  /re_[A-Za-z0-9_-]{10,}/gi, // Resend API keys
  /sk_[A-Za-z0-9_-]{10,}/gi, // claves estilo "secret key"
  /Bearer\s+[A-Za-z0-9._-]{10,}/gi,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9._-]{10,}/gi, // JWT
  /[A-Za-z0-9_-]{32,}/g // cualquier token largo genérico
];

export function sanitizeEmailError(raw: string | null): string | null {
  if (!raw) {
    return null;
  }

  let sanitized = raw;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTADO]');
  }
  return sanitized;
}
