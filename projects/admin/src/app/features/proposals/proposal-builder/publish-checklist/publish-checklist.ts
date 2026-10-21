import { Component, computed, input, output } from '@angular/core';
import { PublishProblem, pendingLabel } from '../../../../core/models/publish-readiness';

/**
 * Lista de TODO lo que falta para publicar, con un enlace por punto que abre la pestaña (y, si se
 * sabe, el campo, día, servicio o línea exacta). Solo presenta lo que calcula la base
 * (get_publish_readiness): no tiene reglas propias.
 */
@Component({
  selector: 'app-publish-checklist',
  templateUrl: './publish-checklist.html',
  styleUrl: './publish-checklist.css'
})
export class PublishChecklist {
  readonly problems = input.required<PublishProblem[]>();
  readonly selected = output<PublishProblem>();
  /** «publicar» en una propuesta, «compartir» en un itinerario. */
  readonly verb = input<'publicar' | 'compartir'>('publicar');

  readonly title = computed(() => pendingLabel(this.problems().length, this.verb()));

  trackKey(problem: PublishProblem): string {
    return `${problem.code}:${problem.line_id ?? problem.service_id ?? problem.day_id ?? ''}`;
  }
}
