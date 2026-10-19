import { isPublishTab, pendingLabel, problemAnchorId, scrollToAnchor } from './publish-readiness';

const base = { code: 'x', day_id: null, service_id: null, line_id: null };

describe('publish-readiness', () => {
  it('el texto del botón dice cuántos datos faltan', () => {
    expect(pendingLabel(4)).toBe('Faltan 4 datos para publicar');
    expect(pendingLabel(2)).toBe('Faltan 2 datos para publicar');
    expect(pendingLabel(1)).toBe('Falta 1 dato para publicar');
  });

  it('cada regla actual lleva a su campo', () => {
    expect(problemAnchorId({ ...base, code: 'cover_title_missing' })).toBe('cover-title');
    expect(problemAnchorId({ ...base, code: 'days_missing' })).toBe('journey-add-day');
    expect(problemAnchorId({ ...base, code: 'price_lines_missing' })).toBe('pricing-lines');
    expect(problemAnchorId({ ...base, code: 'access_code_missing' })).toBe('access-section');
    expect(problemAnchorId({ ...base, code: 'regla_desconocida' })).toBeNull();
  });

  it('si el problema trae un elemento concreto, lleva a ese: línea > servicio > día', () => {
    expect(problemAnchorId({ ...base, day_id: 'd1' })).toBe('day-d1');
    expect(problemAnchorId({ ...base, day_id: 'd1', service_id: 's1' })).toBe('service-s1');
    expect(problemAnchorId({ ...base, day_id: 'd1', service_id: 's1', line_id: 'l1' })).toBe('line-l1');
  });

  it('solo acepta las pestañas del constructor', () => {
    for (const tab of ['client-trip', 'cover', 'journey', 'pricing']) {
      expect(isPublishTab(tab)).toBe(true);
    }
    expect(isPublishTab('terms')).toBe(false);
    expect(isPublishTab('')).toBe(false);
  });

  describe('scrollToAnchor', () => {
    afterEach(() => {
      document.body.innerHTML = '';
      vi.useRealTimers();
    });

    it('lleva al elemento y enfoca el campo que contiene', () => {
      document.body.innerHTML = '<section id="access-section"><button id="b">Generar</button></section>';
      const section = document.getElementById('access-section')!;
      section.scrollIntoView = vi.fn();
      scrollToAnchor('access-section');
      expect(section.scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'center' });
      expect(document.activeElement?.id).toBe('b');
    });

    it('enfoca el propio elemento si es un campo', () => {
      document.body.innerHTML = '<input id="cover-title" />';
      const input = document.getElementById('cover-title')!;
      input.scrollIntoView = vi.fn();
      scrollToAnchor('cover-title');
      expect(document.activeElement).toBe(input);
    });

    it('espera a que la pestaña termine de montarse (el elemento aparece después)', () => {
      vi.useFakeTimers();
      scrollToAnchor('journey-add-day');
      document.body.innerHTML = '<button id="journey-add-day">+ Agregar día</button>';
      const button = document.getElementById('journey-add-day')!;
      button.scrollIntoView = vi.fn();
      vi.advanceTimersByTime(130);
      expect(button.scrollIntoView).toHaveBeenCalled();
      expect(document.activeElement).toBe(button);
    });

    it('si el elemento nunca aparece, deja de intentar sin fallar', () => {
      vi.useFakeTimers();
      expect(() => {
        scrollToAnchor('no-existe', { tries: 3, delayMs: 10 });
        vi.advanceTimersByTime(500);
      }).not.toThrow();
      expect(vi.getTimerCount()).toBe(0);
    });

    it('sin id no hace nada', () => {
      expect(() => scrollToAnchor(null)).not.toThrow();
    });
  });
});
