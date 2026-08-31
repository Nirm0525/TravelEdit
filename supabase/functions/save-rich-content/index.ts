// Edge Function: save-rich-content
//
// destinations.long_description y articles.body se revocaron de UPDATE para
// el rol `authenticated` (ver 0002_destinations.sql). La única forma de
// escribirlas es aquí: se sanea con una librería real antes de guardar, y
// esta función corre con la service role — por eso vuelve a validar el rol
// del que llama ella misma, RLS ya no la protege en este punto.
import { createClient } from 'npm:@supabase/supabase-js@2';
import sanitizeHtml from 'npm:sanitize-html@2';

// Mismo patrón que admin-users/settings-status: el navegador manda un
// preflight OPTIONS antes del POST (siempre que haya header Authorization),
// y sin esto la función quedaba inalcanzable desde cualquier origen — el
// preflight fallaba con 405 y sin Access-Control-Allow-Origin.
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

type TableName = 'destinations' | 'articles';

const COLUMN_BY_TABLE: Record<TableName, string> = {
  destinations: 'long_description',
  articles: 'body'
};

// Debe cubrir exactamente lo que el toolbar de RichTextEditor (Tiptap) puede
// producir — ver projects/admin/src/app/shared/ui/rich-text-editor/rich-text-editor.ts.
// Antes de este cambio, el allowlist solo tenía las marcas/nodos básicos de
// StarterKit + link: cualquier fuente/color/alineación/tabla/imagen/highlight/
// lista de tareas elegida en el editor se perdía silenciosamente al guardar
// (sanitize-html las descarta si el tag o el atributo no está permitido).
const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p', 'br', 'strong', 'em', 'u', 's', 'code', 'pre',
    'h1', 'h2', 'h3', 'h4', 'blockquote', 'hr',
    'ul', 'ol', 'li',
    'a', 'img', 'mark', 'span', 'div', 'label', 'input',
    'table', 'thead', 'tbody', 'tr', 'th', 'td'
  ],
  allowedAttributes: {
    a: ['href', 'rel', 'target'],
    img: ['src', 'alt', 'title'],
    ul: ['data-type'],
    li: ['data-type', 'data-checked'],
    input: [{ name: 'type', values: ['checkbox'] }, 'checked'],
    '*': ['style']
  },
  // Restringe qué propiedades CSS (y qué valores) sobreviven dentro de un
  // style="..." — nunca un passthrough libre. Cubre exactamente lo que
  // fontFamily/fontSize/setColor/setHighlight/setTextAlign del editor generan.
  allowedStyles: {
    '*': {
      color: [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([\d\s,%.]+\)$/, /^color-mix\([^)]*\)$/],
      'background-color': [/^#[0-9a-fA-F]{3,8}$/, /^rgb\([\d\s,%.]+\)$/, /^color-mix\([^)]*\)$/],
      'font-family': [/^[a-zA-Z0-9\s,"'-]+$/],
      'font-size': [/^[0-9.]+(px|rem|em)$/],
      'text-align': [/^(left|center|right|justify)$/]
    }
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: {
    img: ['http', 'https']
  }
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
  const cors = corsHeadersFor(req);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  // Cualquier fallo no anticipado (JSON mal formado, Supabase caído, etc.)
  // cae aquí en vez de dejar que el runtime devuelva un error sin CORS ni
  // mensaje controlado — mismo patrón que submit-lead/admin-users.
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return json({ error: 'Falta el token de sesión.' }, 401);
    }

    const body = (await req.json().catch(() => null)) as Partial<RequestBody> | null;
    if (!body || !isTableName(body.table) || typeof body.id !== 'string' || typeof body.html !== 'string') {
      return json({ error: 'Solicitud inválida.' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // cliente "como el usuario" solo para confirmar quién es y su rol de staff
    const callerClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });

    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: 'Sesión inválida.' }, 401);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey);

    const { data: profile, error: profileError } = await serviceClient
      .from('profiles')
      .select('role')
      .eq('id', userData.user.id)
      .single();

    if (profileError || !profile || (profile.role !== 'admin' && profile.role !== 'editor')) {
      return json({ error: 'No autorizado.' }, 403);
    }

    const clean = sanitizeHtml(body.html, SANITIZE_OPTIONS);
    const column = COLUMN_BY_TABLE[body.table];

    const { error: updateError } = await serviceClient
      .from(body.table)
      .update({ [column]: clean })
      .eq('id', body.id);

    if (updateError) {
      console.error('save-rich-content: update falló', updateError);
      return json({ error: 'No se pudo guardar.' }, 500);
    }

    return json({ ok: true, html: clean }, 200);
  } catch (err) {
    console.error('save-rich-content: error inesperado', err);
    return json({ error: 'No se pudo procesar la solicitud.' }, 500);
  }
});
