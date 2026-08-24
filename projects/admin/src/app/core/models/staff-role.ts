export type StaffRole = 'admin' | 'editor' | 'staff';

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  admin: 'Admin',
  editor: 'Editor',
  staff: 'Staff'
};
