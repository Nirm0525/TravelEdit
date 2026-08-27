import { StaffRole } from '../models/staff-role';

export type PermissionKey =
  | 'dashboard'
  | 'contenido'
  | 'blog'
  | 'destinos'
  | 'solicitudes'
  | 'usuarios'
  | 'configuracion';

// Solo controla navegación/UI (ocultar enlaces, bloquear rutas al instante).
// La protección real vive en las políticas RLS de Supabase — ver
// supabase/migrations/0007_roles_permissions.sql, 0019_site_settings.sql
// (site_settings solo admite admin, igual que este permiso) y
// 0021_articles.sql (articles_insert/articles_update usan can_manage_content(),
// coherente con que 'blog' no está en el arreglo de staff).
export const ROLE_PERMISSIONS: Record<StaffRole, PermissionKey[]> = {
  admin: ['dashboard', 'contenido', 'blog', 'destinos', 'solicitudes', 'usuarios', 'configuracion'],
  editor: ['dashboard', 'contenido', 'blog', 'destinos'],
  staff: ['dashboard', 'solicitudes']
};

export function canAccess(role: StaffRole | undefined, key: PermissionKey): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(key);
}
