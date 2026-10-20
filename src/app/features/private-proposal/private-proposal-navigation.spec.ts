import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ITINERARY_FIRST_DAY_ANCHOR, PrivateProposal, SCROLL_TOP_GAP_PX } from './private-proposal';
import { PublicProposalData, PublicProposalService } from '../../core/services/public-proposal';
import { ReducedMotionService } from '../../core/services/reduced-motion';
import { toProposalContent } from '../../core/models/proposal-content.model';

const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';

const day = (id: string, dayNumber: number) => ({
  id, dayNumber, title: `Día ${dayNumber}`, location: '', description: '', imagePath: null,
  services: [{ id: `${id}-s`, type: 'flight', title: `Vuelo ${dayNumber}`, description: '', notes: '', time: '', imagePath: null, details: {} }]
});

function data(dayNumbers = [1, 2]): PublicProposalData {
  return {
    content: toProposalContent({
      cover: { title: 'Viaje de prueba' },
      days: dayNumbers.map((n) => day(`d${n}`, n)),
      travelTips: [{ id: 'g1', destination: 'Santiago', tips: [{ id: 't1', title: 'Clima', body: 'Lleve abrigo.' }] }],
      pricing: { lines: [{ id: 'l1', label: 'Paquete', quantity: 1, unitPrice: 100 }], feesLines: [] },
      terms: { title: 'Términos y condiciones', body: '<p>Texto</p>' }
    }),
    pricingSubtotal: 100, pricingFees: 0, pricingTotal: 100, currency: 'USD', status: 'published', termsAccepted: false, acceptedAt: null,
    clientName: 'Persona Ejemplo', destinationText: null, startDate: '2027-05-04', endDate: '2027-05-07', travelersCount: 2, serviceChoices: {}, serviceComments: {}
  };
}

/** Posición absoluta (px desde el inicio del documento) de cada destino, para simular el layout que jsdom no calcula. */
const POSITIONS: Record<string, number> = { itinerario: 900, 'dia-d1': 1500, 'dia-d2': 2200, 'dia-d3': 2900, consejos: 3600, inversion: 4300, terminos: 5000, aceptar: 5700 };

describe('PrivateProposal — navegación interna (una sola función de scroll)', () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<PrivateProposal>;
  let scrollY: number;
  let scrollTo: ReturnType<typeof vi.fn>;
  let menuButtonBottom: number;

  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const menuItem = (id: string) => el().querySelector<HTMLButtonElement>(`.proposal__sidebar-list button[data-section="${id}"]`)!;
  const calls = () => scrollTo.mock.calls.map((c) => c[0] as { top: number; behavior: string });
  /** Lo que debería valer `top` para un destino: su posición menos el aire (y la altura del botón de menú fijo si se ve). */
  const expectedTop = (id: string, fixedHeight = 0) => POSITIONS[id] - (fixedHeight + SCROLL_TOP_GAP_PX);

  async function create(opts: { content?: PublicProposalData; reduced?: boolean } = {}): Promise<void> {
    api.getContent.mockResolvedValue(opts.content ?? data());
    TestBed.inject(ReducedMotionService).reduced.set(opts.reduced ?? true);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    scrollY = 0;
    menuButtonBottom = 56;
    scrollTo = vi.fn((opts: { top: number }) => {
      scrollY = opts.top;
    });
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    // jsdom no implementa estos métodos de elemento (el menú lateral desplaza su propia lista con Element.scrollTo).
    Element.prototype.scrollTo = vi.fn() as unknown as typeof Element.prototype.scrollTo;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'scrollY', { get: () => scrollY, configurable: true });
    // Layout simulado: la posición en pantalla de un destino es su posición absoluta menos lo que se lleva desplazado.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      const key = this.id in POSITIONS ? this.id : (this.dataset['anchor'] === ITINERARY_FIRST_DAY_ANCHOR ? 'dia-d1' : '');
      const absolute = this.classList.contains('proposal__menu-button') ? menuButtonBottom - 40 : (POSITIONS[key] ?? 0);
      const top = this.classList.contains('proposal__menu-button') ? absolute : absolute - scrollY;
      return { top, bottom: this.classList.contains('proposal__menu-button') ? menuButtonBottom : top, left: 0, right: 0, width: 0, height: 0, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    const observer = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): unknown[] {
        return [];
      }
    };
    vi.stubGlobal('IntersectionObserver', observer);
    vi.stubGlobal('ResizeObserver', observer);
    sessionStorage.clear();
    api = {
      getProposalGate: vi.fn().mockResolvedValue({ accessRequired: false, clientName: 'Persona Ejemplo', coverTitle: 'Viaje', coverImagePath: null, status: 'published' }),
      verifyAccess: vi.fn().mockResolvedValue({ result: 'ok', sessionToken: SESSION, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      getContent: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue([])
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
  });

  afterEach(() => {
    fixture?.destroy();
    document.documentElement.classList.remove('proposal-nav-open');
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('«Ver itinerario completo» lleva al Día 1 (no al contenedor del itinerario), una sola vez', async () => {
    await create();
    (el().querySelector('.proposal__itinerary-toggle') as HTMLButtonElement).click();
    await settle();
    expect(calls()).toEqual([{ top: expectedTop('dia-d1'), behavior: 'instant' }]);
    // El Día 1 tiene un ancla estable y recibe el foco, sin volver a desplazar.
    const first = el().querySelector(`[data-anchor="${ITINERARY_FIRST_DAY_ANCHOR}"]`) as HTMLElement;
    expect(first.id).toBe('dia-d1');
    expect(document.activeElement).toBe(first);
  });

  it('cada día tiene su ancla estable itinerary-day-N', async () => {
    await create();
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
    expect(Array.from(el().querySelectorAll('.proposal__day')).map((d) => d.getAttribute('data-anchor'))).toEqual(['itinerary-day-1', 'itinerary-day-2']);
  });

  for (const [label, id] of [['Itinerario', 'itinerario'], ['Consejos (Travel Tips)', 'consejos'], ['Inversión', 'inversion'], ['Términos', 'terminos']] as const) {
    it(`el menú «${label}» lleva al inicio exacto de la sección`, async () => {
      await create();
      menuItem(id).click();
      await settle();
      expect(calls()).toEqual([{ top: expectedTop(id), behavior: 'instant' }]);
      expect(document.activeElement).toBe(document.getElementById(id));
    });
  }

  it('el menú de un día expande el itinerario si sigue colapsado y llega al inicio de ese día', async () => {
    await create();
    expect(el().querySelector('.proposal__days')).toBeNull();
    menuItem('dia-d2').click();
    await settle();
    expect(el().querySelector('.proposal__days')).not.toBeNull();
    expect(calls()).toEqual([{ top: expectedTop('dia-d2'), behavior: 'instant' }]);
  });

  it('descuenta la altura REAL del botón de menú fijo (móvil/tablet) además del aire', async () => {
    await create();
    const button = el().querySelector('.proposal__menu-button') as HTMLElement;
    button.style.position = 'fixed';
    button.style.display = 'flex';
    menuItem('inversion').click();
    await settle();
    expect(calls()[0].top).toBe(expectedTop('inversion', menuButtonBottom));
    // Si el botón no es fijo/visible (escritorio) no se descuenta nada más que el aire.
    scrollTo.mockClear();
    button.style.display = 'none';
    menuItem('terminos').click();
    await settle();
    expect(calls()[0].top).toBe(expectedTop('terminos'));
  });

  it('móvil: el cajón se cierra (y se libera el bloqueo del body) ANTES de desplazar, y el foco va al destino', async () => {
    await create();
    fixture.componentInstance.toggleNav();
    fixture.detectChanges();
    expect(document.documentElement.classList.contains('proposal-nav-open')).toBe(true);
    const seenAtScroll: { navOpen: boolean; locked: boolean }[] = [];
    scrollTo.mockImplementation((opts: { top: number }) => {
      seenAtScroll.push({ navOpen: fixture.componentInstance.navOpen(), locked: document.documentElement.classList.contains('proposal-nav-open') });
      scrollY = opts.top;
    });
    menuItem('consejos').click();
    await settle();
    expect(seenAtScroll).toEqual([{ navOpen: false, locked: false }]);
    expect(document.activeElement).toBe(document.getElementById('consejos'));
    expect(document.activeElement).not.toBe(el().querySelector('.proposal__menu-button'));
  });

  it('si no existe el Día 1, cae en el primer día que haya; y un día desconocido, en el contenedor del itinerario', async () => {
    await create({ content: data([2, 3]) });
    expect(el().querySelector(`[data-anchor="${ITINERARY_FIRST_DAY_ANCHOR}"]`)).toBeNull();
    (el().querySelector('.proposal__itinerary-toggle') as HTMLButtonElement).click();
    await settle();
    expect(calls()).toEqual([{ top: expectedTop('dia-d2'), behavior: 'instant' }]);

    scrollTo.mockClear();
    await fixture.componentInstance.scrollToSection('dia-no-existe');
    await settle();
    expect(calls()).toEqual([{ top: expectedTop('itinerario'), behavior: 'instant' }]);
  });

  it('prefers-reduced-motion: scroll instantáneo; sin esa preferencia, suave', async () => {
    await create({ reduced: true });
    menuItem('inversion').click();
    await settle();
    expect(calls().map((c) => c.behavior)).toEqual(['instant']);

    scrollTo.mockClear();
    TestBed.inject(ReducedMotionService).reduced.set(false);
    const pending = fixture.componentInstance.scrollToSection('terminos');
    await settle();
    expect(calls().map((c) => c.behavior)).toEqual(['smooth']);
    window.dispatchEvent(new Event('scrollend')); // termina el scroll suave
    await pending;
    expect(calls().length).toBe(1); // llegó: no hace falta corregir
  });

  it('si el layout se movió durante el scroll suave, corrige UNA vez al terminar (sin animar)', async () => {
    await create({ reduced: false });
    const pending = fixture.componentInstance.scrollToSection('inversion');
    await settle();
    scrollY -= 40; // una animación/imagen movió la página: quedó 40 px antes del destino
    window.dispatchEvent(new Event('scrollend'));
    await pending;
    expect(calls().length).toBe(2);
    expect(calls()[1]).toEqual({ top: expectedTop('inversion'), behavior: 'instant' });
  });

  it('dos pedidos seguidos: solo se cumple el último (nunca scrolls duplicados o compitiendo)', async () => {
    await create();
    const first = fixture.componentInstance.scrollToSection('consejos');
    const second = fixture.componentInstance.scrollToSection('terminos');
    await settle();
    await Promise.all([first, second]);
    expect(calls()).toEqual([{ top: expectedTop('terminos'), behavior: 'instant' }]);
  });

  it('un pedido antes de que cargue la propuesta se cumple cuando el contenido ya está pintado', async () => {
    let resolveContent!: (v: PublicProposalData) => void;
    api.getContent.mockReturnValue(new Promise((resolve) => (resolveContent = resolve)));
    TestBed.inject(ReducedMotionService).reduced.set(true);
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    await fixture.componentInstance.scrollToSection('inversion');
    expect(scrollTo).not.toHaveBeenCalled();

    resolveContent(data());
    await settle();
    expect(calls()).toEqual([{ top: expectedTop('inversion'), behavior: 'instant' }]);
  });

  it('no queda ningún scrollIntoView suelto: todo el desplazamiento pasa por window.scrollTo', async () => {
    await create();
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => undefined);
    (el().querySelector('.proposal__itinerary-toggle') as HTMLButtonElement).click();
    await settle();
    menuItem('terminos').click();
    await settle();
    expect(spy).not.toHaveBeenCalled();
  });
});
