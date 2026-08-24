// Edge Function: admin-users
//
// El correo, la fecha de último acceso y el estado de la cuenta viven en
// auth.users, un esquema al que el cliente nunca tiene acceso directo (ni
// siquiera autenticado). Esta función corre con la service role para leerlo
// y modificarlo vía la Admin API — pero antes de cualquier acción vuelve a
// confirmar ella misma que quien llama es admin, porque en este punto RLS
// ya no protege nada (mismo patrón que save-rich-content).
import { createClient } from 'npm:@supabase/supabase-js@2';

type StaffRole = 'admin' | 'editor' | 'staff';
type UserStatus = 'active' | 'inactive';

const ROLES: StaffRole[] = ['admin', 'editor', 'staff'];
const PERMANENT_BAN = '876600h'; // ~100 años — "desactivado" hasta que se reactive a mano.

// Orígenes reales del proyecto — nada de "*": el navegador manda un
// preflight OPTIONS antes de cualquier request con header Authorization,
// y ese preflight debe responderse con el origen exacto que llama.
// 4301 (ng serve admin standalone), 4305 (build combinado) y 4200 (ng serve
// público) son los puertos locales reales usados durante este desarrollo.
const ALLOWED_ORIGINS = new Set([
  'http://localhost:4200',
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

function isValidEmail(value: unknown): value is string {
  return typeof value === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === 'string' && (ROLES as string[]).includes(value);
}

Deno.serve(async (req) => {
  const cors = corsHeadersFor(req);

  // El preflight se responde antes que cualquier otra cosa: sin sesión,
  // sin rol, sin tocar la base de datos.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  const json = (body: unknown, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  if (req.method !== 'POST') {
    return json({ code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }, 405);
  }

  // Headers.get() ya es insensible a mayúsculas/minúsculas por spec (Fetch API) —
  // req.headers.get('Authorization') y req.headers.get('authorization') son
  // exactamente la misma llamada. Igual se valida el prefijo "Bearer " y se
  // extrae el token de forma explícita, en vez de solo comprobar que exista.
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

  const body = await req.json().catch(() => null);
  const action = body?.action ?? 'list';

  try {
    if (action === 'list') {
      return json({ users: await listUsers(serviceClient) }, 200);
    }

    if (action === 'create') {
      return json(await createUser(serviceClient, body), 200);
    }

    if (action === 'update') {
      if (body?.userId === userData.user.id && (body?.role || body?.status)) {
        return json({ code: 'BAD_REQUEST', error: 'No puedes cambiar tu propio rol ni tu propio estado.' }, 400);
      }
      return json(await updateUser(serviceClient, body), 200);
    }

    if (action === 'delete') {
      if (body?.userId === userData.user.id) {
        return json({ code: 'BAD_REQUEST', error: 'No puedes eliminar tu propia cuenta.' }, 400);
      }
      await deleteUser(serviceClient, body);
      return json({ ok: true }, 200);
    }

    return json({ code: 'BAD_REQUEST', error: 'Acción no reconocida.' }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo completar la operación.';
    return json({ code: 'INTERNAL_ERROR', error: message }, 500);
  }
});

// deno-lint-ignore no-explicit-any
async function listUsers(serviceClient: any) {
  const [{ data: authUsers, error: authError }, { data: profiles, error: profilesError }] = await Promise.all([
    serviceClient.auth.admin.listUsers(),
    serviceClient.from('profiles').select('id, full_name, role, created_at')
  ]);

  if (authError) {
    throw new Error('No se pudo leer la lista de usuarios.');
  }
  if (profilesError) {
    throw new Error('No se pudo leer los perfiles.');
  }

  const profileById = new Map((profiles ?? []).map((p: { id: string }) => [p.id, p]));

  return authUsers.users
    .filter((authUser: { id: string }) => profileById.has(authUser.id))
    .map((authUser: { id: string; email?: string; email_confirmed_at?: string; last_sign_in_at?: string; banned_until?: string }) => {
      const profile = profileById.get(authUser.id) as { full_name: string; role: StaffRole; created_at: string };
      const banned = !!authUser.banned_until && new Date(authUser.banned_until) > new Date();
      return {
        id: authUser.id,
        fullName: profile.full_name,
        email: authUser.email ?? '',
        role: profile.role,
        status: banned ? 'inactive' : authUser.email_confirmed_at ? 'active' : 'invited',
        createdAt: profile.created_at,
        lastSignInAt: authUser.last_sign_in_at ?? null
      };
    });
}

// deno-lint-ignore no-explicit-any
async function createUser(serviceClient: any, body: any) {
  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const role = body?.role;
  const status: UserStatus = body?.status === 'inactive' ? 'inactive' : 'active';

  if (!fullName) {
    throw new Error('El nombre es obligatorio.');
  }
  if (!isValidEmail(email)) {
    throw new Error('El correo no es válido.');
  }
  if (!isStaffRole(role)) {
    throw new Error('El rol no es válido.');
  }

  const { data, error } = await serviceClient.auth.admin.inviteUserByEmail(email, {
    data: { full_name: fullName }
  });

  if (error || !data.user) {
    throw new Error(error?.message ?? 'No se pudo invitar al usuario.');
  }

  const newUserId = data.user.id;

  // handle_new_user() ya creó el perfil con rol 'editor' por defecto —
  // se corrige si pidieron otro rol.
  if (role !== 'editor') {
    const { error: roleError } = await serviceClient.from('profiles').update({ role }).eq('id', newUserId);
    if (roleError) {
      throw new Error('El usuario se creó, pero no se pudo asignar el rol solicitado.');
    }
  }

  if (status === 'inactive') {
    await serviceClient.auth.admin.updateUserById(newUserId, { ban_duration: PERMANENT_BAN });
  }

  return { id: newUserId };
}

// deno-lint-ignore no-explicit-any
async function updateUser(serviceClient: any, body: any) {
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) {
    throw new Error('Falta el usuario a editar.');
  }

  if (body?.fullName !== undefined || body?.role !== undefined) {
    const patch: Record<string, unknown> = {};

    if (body?.fullName !== undefined) {
      const fullName = String(body.fullName).trim();
      if (!fullName) {
        throw new Error('El nombre es obligatorio.');
      }
      patch['full_name'] = fullName;
    }

    if (body?.role !== undefined) {
      if (!isStaffRole(body.role)) {
        throw new Error('El rol no es válido.');
      }
      patch['role'] = body.role;
    }

    const { error } = await serviceClient.from('profiles').update(patch).eq('id', userId);
    if (error) {
      throw new Error('No se pudo actualizar el perfil.');
    }
  }

  if (body?.email !== undefined) {
    if (!isValidEmail(body.email)) {
      throw new Error('El correo no es válido.');
    }
    const { error } = await serviceClient.auth.admin.updateUserById(userId, { email: body.email });
    if (error) {
      throw new Error('No se pudo actualizar el correo.');
    }
  }

  if (body?.status !== undefined) {
    const ban_duration = body.status === 'inactive' ? PERMANENT_BAN : 'none';
    const { error } = await serviceClient.auth.admin.updateUserById(userId, { ban_duration });
    if (error) {
      throw new Error('No se pudo actualizar el estado.');
    }
  }

  return { id: userId };
}

// deno-lint-ignore no-explicit-any
async function deleteUser(serviceClient: any, body: any) {
  const userId = typeof body?.userId === 'string' ? body.userId : '';
  if (!userId) {
    throw new Error('Falta el usuario a eliminar.');
  }

  const { error } = await serviceClient.auth.admin.deleteUser(userId);
  if (error) {
    throw new Error('No se pudo eliminar el usuario.');
  }
}
