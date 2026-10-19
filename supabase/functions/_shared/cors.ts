// CORS limitado a los dominios del admin (nunca '*').
// Los dominios salen del secret ALLOWED_ORIGINS (lista separada por comas); sin él, la misma lista
// que usan las demás Edge Functions del proyecto.
export const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
];

export function corsHeadersFor(req: Request, configured: string | undefined): Record<string, string> {
  const allowed = configured ? configured.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_ALLOWED_ORIGINS;
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (allowed.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}
