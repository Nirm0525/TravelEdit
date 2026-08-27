import { Component, DestroyRef, inject, signal } from '@angular/core';
import { EXPERIENCES, Experience } from '../../core/data/experiences';
import { ExperienceIcon } from './experience-icon/experience-icon';
import { SectionTitle } from '../../shared/ui/section-title/section-title';
import { SiteContentService } from '../../core/services/site-content';

// Más lento que un carousel genérico a propósito — la sensación buscada es
// "premium y pausada", no un ciclo constante llamando la atención.
const CYCLE_MS = 4200;

interface ExperiencesHeading {
  eyebrow: string;
  headingLine1: string;
  headingLine2: string;
  support: string;
}

const HEADING_DEFAULT: ExperiencesHeading = {
  eyebrow: 'Experiences',
  headingLine1: 'How do you',
  headingLine2: 'want to feel?',
  support: 'Every journey starts with how you want to experience it.'
};

@Component({
  selector: 'app-experiences',
  standalone: true,
  imports: [ExperienceIcon, SectionTitle],
  templateUrl: './experiences.html',
  styleUrl: './experiences.css'
})
export class Experiences {
  private readonly siteContent = inject(SiteContentService);
  private readonly destroyRef = inject(DestroyRef);

  readonly heading = signal<ExperiencesHeading>(HEADING_DEFAULT);
  readonly experiences = signal<Experience[]>(EXPERIENCES);
  readonly activeIndex = signal(0);

  // Qué tarjeta del trío está "al frente" dentro de la categoría activa — un
  // intervalo la va rotando sola para que el abanico se sienta vivo incluso
  // sin que el usuario mueva el cursor, no solo al cambiar de pestaña.
  readonly frontCardIndex = signal(0);
  private readonly reducedMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  private cycleTimer?: ReturnType<typeof setInterval>;

  constructor() {
    void this.load();
    this.restartCycle();
    this.destroyRef.onDestroy(() => clearInterval(this.cycleTimer));
  }

  // El trío curado para el abanico no vive en site_content.experiencias (ese
  // CMS solo guarda name/icon/image por categoría) — se busca por slug para
  // que un nombre/ícono/imagen editado desde el panel se siga respetando.
  private readonly cardsBySlug = new Map(EXPERIENCES.map((experience) => [experience.slug, experience.cards]));

  private async load(): Promise<void> {
    const data = await this.siteContent.getExperiencias();
    if (!data) {
      return;
    }
    this.heading.update((current) => ({ ...current, ...data }));
    if (data.items && data.items.length > 0) {
      this.experiences.set(data.items.map((item) => ({ ...item, cards: this.cardsBySlug.get(item.slug) })));
    }
  }

  setActive(index: number): void {
    if (this.activeIndex() === index) {
      return;
    }
    this.activeIndex.set(index);
    this.frontCardIndex.set(0);
    this.restartCycle();
  }

  /** front/left/right relativo al índice que el ciclo automático puso al frente
   *  ahora — no depende del orden en el DOM, así la misma tarjeta puede pasar
   *  de estar detrás a adelante con una transición suave en vez de saltar. */
  cardPosition(cardIndex: number, total: number): 'front' | 'left' | 'right' {
    const offset = (cardIndex - this.frontCardIndex() + total) % total;
    if (offset === 0) {
      return 'front';
    }
    return offset === 1 ? 'right' : 'left';
  }

  pauseCycle(): void {
    clearInterval(this.cycleTimer);
  }

  resumeCycle(): void {
    this.restartCycle();
  }

  private restartCycle(): void {
    clearInterval(this.cycleTimer);
    if (this.reducedMotion) {
      return;
    }
    const total = this.experiences()[this.activeIndex()]?.cards?.length ?? 0;
    if (total < 2) {
      return;
    }
    this.cycleTimer = setInterval(() => {
      this.frontCardIndex.update((i) => (i + 1) % total);
    }, CYCLE_MS);
  }
}
