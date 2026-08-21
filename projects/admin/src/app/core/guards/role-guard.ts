import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { StaffRole } from '../models/staff-role';

export function roleGuard(role: StaffRole): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.ready();

    if (auth.profile()?.role === role) {
      return true;
    }

    return router.createUrlTree(['/login']);
  };
}
