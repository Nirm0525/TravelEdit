import { CanDeactivateFn } from '@angular/router';

export interface HasUnsavedChanges {
  hasUnsavedChanges(): boolean;
}

/** Genérico: cualquier componente que implemente hasUnsavedChanges() queda protegido
 *  contra salidas accidentales — no depende de qué formulario sea. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component.hasUnsavedChanges()) {
    return true;
  }
  return confirm('Tienes cambios sin guardar. ¿Seguro que quieres salir sin guardarlos?');
};
