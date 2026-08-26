import { StaffRole } from './staff-role';

export type UserStatus = 'active' | 'invited' | 'inactive';

export interface AdminUser {
  id: string;
  fullName: string;
  email: string;
  role: StaffRole;
  status: UserStatus;
  createdAt: string;
  lastSignInAt: string | null;
}

export interface CreateUserPayload {
  fullName: string;
  email: string;
  role: StaffRole;
  status: 'active' | 'inactive';
}

export interface UpdateUserPayload {
  userId: string;
  fullName?: string;
  email?: string;
  role?: StaffRole;
  status?: 'active' | 'inactive';
}
