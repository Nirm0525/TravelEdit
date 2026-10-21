import { StaffRole } from '../models/staff-role';

export type PermissionKey =
  | 'dashboard'
  | 'contenido'
  | 'blog'
  | 'destinos'
  | 'solicitudes'
  | 'proposals'
  | 'usuarios'
  | 'configuracion';

// Solo controla navegación/UI (ocultar enlaces, bloquear rutas al instante).
// La protección real vive en las políticas RLS de Supabase — ver
// supabase/migrations/0007_roles_permissions.sql, 0019_site_settings.sql
// (site_settings solo admite admin, igual que este permiso) y
// 0021_articles.sql (articles_insert/articles_update usan can_manage_content(),
// coherente con que 'blog' no está en el arreglo de staff).
export const ROLE_PERMISSIONS: Record<StaffRole, PermissionKey[]> = {
  admin: ['dashboard', 'contenido', 'blog', 'destinos', 'solicitudes', 'proposals', 'usuarios', 'configuracion'],
  // 'solicitudes' agregado a editor — ver 0027_grant_editor_leads_access.sql:
  // can_manage_leads() ahora también admite 'editor', no solo admin/staff.
  // 'proposals' sigue el mismo criterio: can_manage_proposals() (0029) admite
  // admin/editor/staff por igual, ya que una propuesta la arma directamente
  // la asesora asignada al lead.
  editor: ['dashboard', 'contenido', 'blog', 'destinos', 'solicitudes', 'proposals'],
  staff: ['dashboard', 'solicitudes', 'proposals']
};

export function canAccess(role: StaffRole | undefined, key: PermissionKey): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(key);
}

// ---------------------------------------------------------------- permisos granulares del módulo «Viajes»
//
// Preparados para separar permisos por submódulo y acción. TODAVÍA no existen en la base: hoy se RESUELVEN desde el rol, con
// el mismo alcance que el permiso 'proposals' (admin, editor y staff), así que no cambia quién puede qué. La protección real
// sigue siendo la RLS (can_manage_proposals()); esto solo decide qué se muestra. Cuando existan permisos en la base, solo
// cambia `ROLE_PERMISSION_CODES` (o su origen); los lugares que preguntan con `can()` no se tocan.

export const PROPOSAL_PERMISSION_CODES = [
  'propuestas.ver',
  'propuestas.crear',
  'propuestas.editar',
  'propuestas.eliminar',
  'propuestas.publicar',
  'propuestas.despublicar',
  'propuestas.gestionar_precios',
  'propuestas.gestionar_terminos',
  'propuestas.gestionar_documentos'
] as const;

export const ITINERARY_PERMISSION_CODES = [
  'itinerarios.ver',
  'itinerarios.crear',
  'itinerarios.editar',
  'itinerarios.eliminar',
  'itinerarios.compartir',
  'itinerarios.gestionar_documentos'
] as const;

export type PermissionCode =
  | 'viajes.ver'
  | (typeof PROPOSAL_PERMISSION_CODES)[number]
  | (typeof ITINERARY_PERMISSION_CODES)[number];

/**
 * Eliminar es SOLO de admin: coincide con la política RLS `proposals_delete` (0029), que solo admite al admin para ambos
 * tipos de viaje. Antes este mapeo se lo daba también a editor y staff, y la interfaz ofrecía un borrado que la base rechaza.
 */
const DELETE_CODES: readonly PermissionCode[] = ['propuestas.eliminar', 'itinerarios.eliminar'];
const ALL_TRAVEL_CODES: readonly PermissionCode[] = [...PROPOSAL_PERMISSION_CODES, ...ITINERARY_PERMISSION_CODES];
const WITHOUT_DELETE = ALL_TRAVEL_CODES.filter((code) => !DELETE_CODES.includes(code));

/** Códigos concretos por rol (sin 'viajes.ver', que se deriva: basta con poder ver alguno de los submódulos). */
export const ROLE_PERMISSION_CODES: Record<StaffRole, readonly PermissionCode[]> = {
  admin: ALL_TRAVEL_CODES,
  editor: WITHOUT_DELETE,
  staff: WITHOUT_DELETE
};

export function can(role: StaffRole | undefined, code: PermissionCode): boolean {
  if (!role) {
    return false;
  }
  if (code === 'viajes.ver') {
    return can(role, 'propuestas.ver') || can(role, 'itinerarios.ver');
  }
  return ROLE_PERMISSION_CODES[role].includes(code);
}
