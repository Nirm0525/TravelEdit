import { gsap, ScrollTrigger, SplitText, registerGsap } from './gsap-setup';

/**
 * Animaciones de /private/:token. Todas corren dentro de un gsap.context con
 * `root` como scope: revert() deja el DOM limpio (estilos inline, SplitText,
 * ScrollTriggers) sin tener que llevar la cuenta de cada tween. El componente
 * decide si llamar o no a estas funciones según prefers-reduced-motion.
 */

/** Salida del panel de acceso — resuelve cuando termina, para que el
 *  componente recién ahí cambie a la fase 'content'. */
export function playGateExit(root: HTMLElement): Promise<void> {
  registerGsap();
  const gate = root.querySelector<HTMLElement>('.private-proposal__gate');
  if (!gate) {
    return Promise.resolve();
  }
  const panel = gate.querySelector<HTMLElement>('.private-proposal__gate-panel-inner');
  const photo = gate.querySelector<HTMLElement>('.private-proposal__gate-hero-photo');

  return new Promise((resolve) => {
    const tl = gsap.timeline({ onComplete: () => resolve() });
    if (panel) {
      tl.to(panel, { autoAlpha: 0, x: -48, duration: 0.5, ease: 'power2.in' }, 0);
    }
    if (photo) {
      tl.to(photo, { scale: 1.06, duration: 0.8, ease: 'power2.inOut' }, 0);
    }
    tl.to(gate, { autoAlpha: 0, duration: 0.4, ease: 'power1.in' }, '-=0.35');
  });
}

/** Entrada de la propuesta: la portada se "abre" con una cortina, el título
 *  entra palabra por palabra y la foto queda con parallax al hacer scroll. */
export function playProposalIntro(root: HTMLElement): gsap.Context {
  registerGsap();
  return gsap.context(() => {
    const hero = root.querySelector<HTMLElement>('.proposal__hero');
    if (!hero) {
      return;
    }
    const image = hero.querySelector<HTMLElement>('.proposal__hero-image');
    const title = hero.querySelector<HTMLElement>('.proposal__hero-title');
    const supporting = hero.querySelectorAll<HTMLElement>(
      '.proposal__topbar, .proposal__hero-content > :not(.proposal__hero-title)'
    );

    gsap.fromTo(
      hero,
      { clipPath: 'inset(0 0 100% 0)' },
      { clipPath: 'inset(0 0 0% 0)', duration: 1.1, ease: 'power4.inOut', clearProps: 'clipPath' }
    );

    if (title) {
      SplitText.create(title, {
        type: 'lines,words',
        mask: 'lines',
        autoSplit: true,
        onSplit: (self) =>
          gsap.from(self.words, { yPercent: 115, duration: 1.1, stagger: 0.07, delay: 0.55, ease: 'power4.out' })
      });
    }

    gsap.from(supporting, { autoAlpha: 0, y: 22, duration: 0.9, stagger: 0.1, delay: 0.9, ease: 'power3.out' });

    if (image) {
      gsap.fromTo(
        image,
        { scale: 1.15, yPercent: 0 },
        {
          yPercent: 6,
          ease: 'none',
          scrollTrigger: { trigger: hero, start: 'top top', end: 'bottom top', scrub: true }
        }
      );
    }
  }, root);
}

/** Elementos de las secciones que se animan con el scroll (tabla resumen del
 *  itinerario, tarjetas del resumen del viaje) + barra de progreso del
 *  sidebar. */
export function setupProposalScroll(root: HTMLElement): gsap.Context {
  registerGsap();
  return gsap.context(() => {
    const layout = root.querySelector<HTMLElement>('.proposal__layout');
    const progress = root.querySelector<HTMLElement>('.proposal__sidebar-progress-bar');
    if (layout && progress) {
      gsap.fromTo(
        progress,
        { scaleY: 0 },
        {
          scaleY: 1,
          ease: 'none',
          transformOrigin: 'top',
          scrollTrigger: { trigger: layout, start: 'top 90%', end: 'bottom bottom', scrub: 0.3 }
        }
      );
    }

    const summary = root.querySelectorAll<HTMLElement>('.proposal__summary-item');
    if (summary.length > 0) {
      gsap.from(summary, {
        autoAlpha: 0,
        y: 28,
        duration: 0.8,
        stagger: 0.12,
        ease: 'power3.out',
        scrollTrigger: { trigger: summary[0], start: 'top 88%' }
      });
    }

    const rows = root.querySelectorAll<HTMLElement>('.proposal__itinerary-table tbody tr');
    if (rows.length > 0) {
      gsap.from(rows, {
        autoAlpha: 0,
        x: -28,
        duration: 0.75,
        stagger: 0.05,
        ease: 'power3.out',
        scrollTrigger: { trigger: '.proposal__itinerary-table', start: 'top 85%' }
      });
    }
  }, root);
}

/** Días del itinerario completo: la foto se destapa con una máscara y se
 *  mueve a distinta velocidad que el scroll; el texto entra escalonado. */
export function animateItineraryDays(root: HTMLElement): gsap.Context {
  registerGsap();
  return gsap.context(() => {
    const days = gsap.utils.toArray<HTMLElement>('.proposal__day', root);
    for (const day of days) {
      const number = day.querySelector<HTMLElement>('.proposal__day-number');
      const media = day.querySelector<HTMLElement>('.proposal__day-media');
      const image = day.querySelector<HTMLElement>('.proposal__day-image');
      const body = day.querySelectorAll<HTMLElement>('.proposal__day-body > *');
      const scrollTrigger = { trigger: day, start: 'top 80%' };

      if (number) {
        gsap.from(number, { autoAlpha: 0, y: 48, duration: 1, ease: 'power4.out', scrollTrigger });
      }
      if (media) {
        gsap.fromTo(
          media,
          { clipPath: 'inset(0 100% 0 0)' },
          { clipPath: 'inset(0 0% 0 0)', duration: 1.1, ease: 'power4.inOut', scrollTrigger, clearProps: 'clipPath' }
        );
      }
      if (image) {
        gsap.fromTo(
          image,
          { scale: 1.2, yPercent: -7 },
          {
            yPercent: 7,
            ease: 'none',
            scrollTrigger: { trigger: day, start: 'top bottom', end: 'bottom top', scrub: true }
          }
        );
      }
      const services = day.querySelectorAll<HTMLElement>('.proposal__service');
      for (const service of Array.from(services)) {
        gsap.from(service, {
          autoAlpha: 0,
          y: 36,
          duration: 0.9,
          ease: 'power3.out',
          scrollTrigger: { trigger: service, start: 'top 88%' }
        });
      }
      gsap.from(body, {
        autoAlpha: 0,
        y: 26,
        duration: 0.8,
        stagger: 0.09,
        delay: 0.2,
        ease: 'power3.out',
        scrollTrigger
      });
    }
  }, root);
}

/** Mueve el indicador del menú lateral hasta el ítem activo. */
export function moveSidebarIndicator(root: HTMLElement, sectionId: string | null, animate: boolean): void {
  const indicator = root.querySelector<HTMLElement>('.proposal__sidebar-indicator');
  const list = root.querySelector<HTMLElement>('.proposal__sidebar-list');
  const scroller = root.querySelector<HTMLElement>('.proposal__sidebar-scroll');
  const item = sectionId
    ? list?.querySelector<HTMLElement>(`li:has(> button[data-section="${sectionId}"])`)
    : null;
  if (!indicator || !item) {
    return;
  }
  registerGsap();
  // El menú tiene scroll propio (muchos días): mantiene el ítem activo a la
  // vista sin mover la página.
  scroller?.scrollTo({
    top: item.offsetTop - scroller.clientHeight / 2 + item.offsetHeight / 2,
    behavior: animate ? 'smooth' : 'auto'
  });
  gsap.to(indicator, {
    y: item.offsetTop,
    height: item.offsetHeight,
    autoAlpha: 1,
    duration: animate ? 0.5 : 0,
    ease: 'power3.out',
    overwrite: true
  });
}

export function refreshScrollTriggers(): void {
  ScrollTrigger.refresh();
}
