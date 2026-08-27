// Edge Function: settings-status
//
// El panel de Configuración necesita mostrar si RESEND_API_KEY y
// TURNSTILE_SECRET_KEY están configurados, pero esos secrets nunca deben
// llegar al navegador — ni siquiera parcialmente. Esta función corre en el
// runtime de la Edge Function (el único lugar donde Deno.env tiene esos
// valores) y responde solo con booleanos. Mismo patrón de autenticación que
// admin-users: primero confirma la sesión con la anon key, después vuelve a
// confirmar el rol admin con la service role antes de responder nada.
import { createClient } from 'npm:@supabase/supabase-js@2';

const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
  'http://localhost:4201',
  'http://localhost:4301',
  'http://localhost:4305',
  'https://thetravel-edit.com'
]);

function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const headers: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin'
  };
  if (ALLOWED_ORIGINS.has(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ code: 'UNAUTHORIZED_NO_AUTH_HEADER', message: 'Missing authorization header' }, 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Invalid authorization token' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${token}` } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser(token);
  if (userError || !userData.user) {
    return json({ code: 'UNAUTHORIZED_INVALID_TOKEN', message: 'Sesión inválida.' }, 401);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: callerProfile, error: callerProfileError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (callerProfileError || !callerProfile || callerProfile.role !== 'admin') {
    return json({ code: 'FORBIDDEN_NOT_ADMIN', message: 'No autorizado.' }, 403);
  }

  // Solo booleanos — nunca el valor del secret, ni siquiera un fragmento.
  return json(
    {
      resendConfigured: !!Deno.env.get('RESEND_API_KEY'),
      turnstileSecretConfigured: !!Deno.env.get('TURNSTILE_SECRET_KEY')
    },
    200
  );
});
