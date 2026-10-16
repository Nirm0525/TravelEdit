import { gsap, ScrollTrigger, SplitText, registerGsap } from './gsap-setup';

/**
 * Animaciones de la Vista previa del constructor de propuestas. Espejo
 * reducido de src/app/core/gsap/proposal-motion.ts del sitio público (apps
 * separadas que no comparten código, ver nota en preview-step.ts): misma
 * entrada de portada y mismos reveals, sin sidebar ni parallax de fotos.
 */

/** La vista previa vive en una columna con scroll propio (ver
 *  .proposal-builder__preview-col) o en página completa — ScrollTrigger
 *  necesita saber cuál es el contenedor que realmente se desplaza. */
function findScroller(el: HTMLElement): HTMLElement | Window {
  let node: HTMLElement | null = el.parentElement;
  while (node && node !== document.body) {
    const overflowY = getComputedStyle(node).overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node;
    }
    node = node.parentElement;
  }
  return window;
}

export function playPreviewIntro(root: HTMLElement): gsap.Context {
  registerGsap();
  return gsap.context(() => {
    const scroller = findScroller(root);
    const cover = root.querySelector<HTMLElement>('.preview__cover');
    const title = root.querySelector<HTMLElement>('.preview__cover-title');
    const supporting = root.querySelectorAll<HTMLElement>(
      '.preview__cover .preview__eyebrow, .preview__cover-subtitle, .preview__cover-meta'
    );

    if (cover) {
      gsap.fromTo(
        cover,
        { clipPath: 'inset(0 0 100% 0)' },
        { clipPath: 'inset(0 0 0% 0)', duration: 0.9, ease: 'power4.inOut', clearProps: 'clipPath' }
      );
    }
    if (title) {
      SplitText.create(title, {
        type: 'lines,words',
        mask: 'lines',
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(self.words, { yPercent: 115, duration: 0.9, stagger: 0.06, delay: 0.4, ease: 'power4.out' })
      });
    }
    gsap.from(supporting, { autoAlpha: 0, y: 16, duration: 0.7, stagger: 0.08, delay: 0.7, ease: 'power3.out' });

    for (const section of gsap.utils.toArray<HTMLElement>('.preview__section', root)) {
      gsap.from(section.children, {
        autoAlpha: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.08,
        ease: 'power3.out',
        scrollTrigger: { trigger: section, scroller, start: 'top 90%' }
      });
    }

    const summary = root.querySelectorAll<HTMLElement>('.preview__summary-item');
    if (summary.length > 0) {
      gsap.from(summary, {
        autoAlpha: 0,
        y: 22,
        duration: 0.7,
        stagger: 0.1,
        ease: 'power3.out',
        scrollTrigger: { trigger: summary[0], scroller, start: 'top 92%' }
      });
    }

    const rows = root.querySelectorAll<HTMLElement>('.preview__itinerary-table tbody tr');
    if (rows.length > 0) {
      gsap.from(rows, {
        autoAlpha: 0,
        x: -22,
        duration: 0.6,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.preview__itinerary-table', scroller, start: 'top 92%' }
      });
    }
  }, root);
}

/** Días del itinerario completo — entran escalonados cuando se expande. */
export function animatePreviewDays(root: HTMLElement): gsap.Context {
  registerGsap();
  return gsap.context(() => {
    const scroller = findScroller(root);
    for (const day of gsap.utils.toArray<HTMLElement>('.preview__day', root)) {
      gsap.from(day.children, {
        autoAlpha: 0,
        y: 24,
        duration: 0.7,
        stagger: 0.09,
        ease: 'power3.out',
        scrollTrigger: { trigger: day, scroller, start: 'top 92%' }
      });
    }
  }, root);
}

/** Mismo motivo que en el sitio público: expandir/colapsar cambia la altura. */
export function refreshPreviewTriggers(): void {
  ScrollTrigger.refresh();
}
