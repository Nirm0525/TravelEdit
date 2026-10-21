import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth';
import { PermissionCode, can } from '../data/permissions';
import { TRAVEL_FEATURES, TravelMode, isTravelModeEnabled, travelPaths } from '../../features/travel/travel-config';

/**
 * Guard de las rutas de Viajes: el modo debe estar habilitado (Itinerarios todavía no lo está: no existe `kind` en la base) y
 * la persona debe tener el permiso. Un modo deshabilitado redirige a Propuestas, nunca deja una lista con datos incorrectos.
 */
export function travelGuard(mode: TravelMode, code: PermissionCode): CanActivateFn {
  return async () => {
    const auth = inject(AuthService);
    const router = inject(Router);
    const features = inject(TRAVEL_FEATURES);

    await auth.ready();

    if (!isTravelModeEnabled(mode, features)) {
      return router.createUrlTree([travelPaths.list('proposal')]);
    }
    if (can(auth.profile()?.role, code)) {
      return true;
    }
    return router.createUrlTree(['/dashboard']);
  };
}
