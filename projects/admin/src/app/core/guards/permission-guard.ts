import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { PermissionKey, canAccess } from '../data/permissions';

export function permissionGuard(key: PermissionKey): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);

    await auth.ready();

    if (canAccess(auth.profile()?.role, key)) {
      return true;
    }

    return router.createUrlTree(['/dashboard']);
  };
}
