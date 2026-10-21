/**
 * Lista de pendientes para publicar una propuesta. La fuente de verdad es la base:
 * get_publish_readiness(proposal_id) (migración 0053), la MISMA función que usa publish_proposal(),
 * así que lo que muestra el constructor y lo que exige la publicación nunca se contradicen.
 */

/** Claves de las pestañas del constructor (BuilderStep) a las que puede apuntar un problema. */
export type PublishTab = 'client-trip' | 'cover' | 'journey' | 'pricing';

export interface PublishProblem {
  position: number;
  code: string;
  /** Mensaje en español, listo para mostrar ("Portada: falta el título."). */
  message: string;
  tab: PublishTab;
  /** Elemento concreto, si la regla es por elemento (hoy todas las reglas son globales: null). */
  day_id: string | null;
  service_id: string | null;
  line_id: string | null;
}

const TABS: readonly string[] = ['client-trip', 'cover', 'journey', 'pricing'];

export function isPublishTab(value: string): value is PublishTab {
  return TABS.includes(value);
}

/** Elemento al que lleva cada regla global (los ids están en las plantillas de cada pestaña). */
const ANCHOR_BY_CODE: Record<string, string> = {
  cover_title_missing: 'cover-title',
  days_missing: 'journey-add-day',
  price_lines_missing: 'pricing-lines',
  access_code_missing: 'access-section',
  services_missing: 'journey-add-day'
};

/** id del elemento al que debe llevar un problema: el más concreto que se sepa (línea > servicio > día > regla). */
export function problemAnchorId(problem: Pick<PublishProblem, 'code' | 'day_id' | 'service_id' | 'line_id'>): string | null {
  if (problem.line_id) {
    return `line-${problem.line_id}`;
  }
  if (problem.service_id) {
    return `service-${problem.service_id}`;
  }
  if (problem.day_id) {
    return `day-${problem.day_id}`;
  }
  return ANCHOR_BY_CODE[problem.code] ?? null;
}

/** Texto del botón de publicar (o de compartir, en un itinerario) mientras hay pendientes. */
export function pendingLabel(count: number, verb: 'publicar' | 'compartir' = 'publicar'): string {
  return count === 1 ? `Falta 1 dato para ${verb}` : `Faltan ${count} datos para ${verb}`;
}

export interface ScrollOptions {
  doc?: Document;
  /** La pestaña se monta y carga sus datos de forma asíncrona: se reintenta hasta que aparezca el elemento. */
  tries?: number;
  delayMs?: number;
}

const FOCUSABLE = 'input, select, textarea, button, [tabindex]';

/** Lleva al elemento (y le da el foco si se puede), esperando a que la pestaña termine de montarse. */
export function scrollToAnchor(id: string | null, options: ScrollOptions = {}): void {
  if (!id) {
    return;
  }
  const doc = options.doc ?? document;
  const tries = options.tries ?? 25;
  const delayMs = options.delayMs ?? 120;

  const attempt = (remaining: number): void => {
    const element = doc.getElementById(id);
    if (!element) {
      if (remaining > 0) {
        setTimeout(() => attempt(remaining - 1), delayMs);
      }
      return;
    }
    element.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    const target = element.matches(FOCUSABLE) ? element : element.querySelector<HTMLElement>(FOCUSABLE);
    target?.focus?.({ preventScroll: true });
  };
  attempt(tries);
}
