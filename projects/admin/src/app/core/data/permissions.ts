import { StaffRole } from '../models/staff-role';

export type PermissionKey = 'dashboard' | 'contenido' | 'destinos' | 'solicitudes' | 'usuarios';

// Solo controla navegación/UI (ocultar enlaces, bloquear rutas al instante).
// La protección real vive en las políticas RLS de Supabase — ver
// supabase/migrations/0007_roles_permissions.sql.
export const ROLE_PERMISSIONS: Record<StaffRole, PermissionKey[]> = {
  admin: ['dashboard', 'contenido', 'destinos', 'solicitudes', 'usuarios'],
  editor: ['dashboard', 'contenido', 'destinos'],
  staff: ['dashboard', 'solicitudes']
};

export function canAccess(role: StaffRole | undefined, key: PermissionKey): boolean {
  return !!role && ROLE_PERMISSIONS[role].includes(key);
}
