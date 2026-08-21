// Edge Function: save-rich-content
//
// destinations.long_description y articles.body se revocaron de UPDATE para
// el rol `authenticated` (ver 0002_destinations.sql). La única forma de
// escribirlas es aquí: se sanea con una librería real antes de guardar, y
// esta función corre con la service role — por eso vuelve a validar el rol
// del que llama ella misma, RLS ya no la protege en este punto.
import { createClient } from 'npm:@supabase/supabase-js@2';
import sanitizeHtml from 'npm:sanitize-html@2';

type TableName = 'destinations' | 'articles';

const COLUMN_BY_TABLE: Record<TableName, string> = {
  destinations: 'long_description',
  articles: 'body'
};

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'u', 's',
    'h2', 'h3', 'blockquote',
    'ul', 'ol', 'li',
    'a'
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target']
  },
  allowedSchemes: ['http', 'https', 'mailto']
};

interface RequestBody {
  table: TableName;
  id: string;
  html: string;
}

function isTableName(value: unknown): value is TableName {
  return value === 'destinations' || value === 'articles';
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Falta el token de sesión.' }), { status: 401 });
  }

  const body = (await req.json()) as Partial<RequestBody>;
  if (!isTableName(body.table) || typeof body.id !== 'string' || typeof body.html !== 'string') {
    return new Response(JSON.stringify({ error: 'Solicitud inválida.' }), { status: 400 });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // cliente "como el usuario" solo para confirmar quién es y su rol de staff
  const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } }
  });

  const { data: userData, error: userError } = await callerClient.auth.getUser();
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Sesión inválida.' }), { status: 401 });
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await serviceClient
    .from('profiles')
    .select('role')
    .eq('id', userData.user.id)
    .single();

  if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'editor')) {
    return new Response(JSON.stringify({ error: 'No autorizado.' }), { status: 403 });
  }

  const clean = sanitizeHtml(body.html, SANITIZE_OPTIONS);
  const column = COLUMN_BY_TABLE[body.table];

  const { error: updateError } = await serviceClient
    .from(body.table)
    .update({ [column]: clean })
    .eq('id', body.id);

  if (updateError) {
    return new Response(JSON.stringify({ error: 'No se pudo guardar.' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, html: clean }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
});
