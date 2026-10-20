import { DEFAULT_TERMS_HTML, DEFAULT_TERMS_SECTION_COUNT, DEFAULT_TERMS_TITLE, termsHasPlaceholders } from './proposal-default-terms';

const headings = () => Array.from(DEFAULT_TERMS_HTML.matchAll(/<h2>(.*?)<\/h2>/g)).map((m) => m[1]);

describe('términos y condiciones de partida', () => {
  it('el título sigue siendo el de siempre (lo comparte la importación desde PDF)', () => {
    expect(DEFAULT_TERMS_TITLE).toBe('Términos y condiciones');
  });

  it('las secciones se numeran solas, en orden y sin saltos', () => {
    const titles = headings();
    expect(titles.length).toBe(DEFAULT_TERMS_SECTION_COUNT);
    titles.forEach((title, index) => expect(title.startsWith(`${index + 1}. `)).toBe(true));
  });

  it('abre con la presentación y cierra con la aceptación', () => {
    expect(DEFAULT_TERMS_HTML.startsWith('<p><em>Experiencias de viaje personalizadas</em></p>')).toBe(true);
    expect(DEFAULT_TERMS_HTML).toContain('bajo la marca comercial Travel Edit, operada por [razón social legal]');
    expect(headings().at(-1)).toMatch(/Aceptación de términos y condiciones$/);
  });

  it('conserva las secciones clave: pagos, cancelación, migración y responsabilidad', () => {
    const titles = headings().join(' | ');
    for (const part of ['Políticas de pago', 'Políticas de cancelación', 'Documentación de viaje y responsabilidad migratoria del cliente', 'Responsabilidad', 'Condiciones particulares de cada reserva']) {
      expect(titles).toContain(part);
    }
  });

  it('las enumeraciones salen como listas HTML', () => {
    expect(DEFAULT_TERMS_HTML).toContain('<ul><li>Pago total al momento de confirmar.</li>');
    expect((DEFAULT_TERMS_HTML.match(/<ul>/g) ?? []).length).toBe(4);
  });

  it('no inventa cifras: no hay ningún porcentaje fijo de depósito ni plazo único', () => {
    expect(DEFAULT_TERMS_HTML).toContain('No existe un porcentaje de depósito ni un plazo de pago universal');
    expect(DEFAULT_TERMS_HTML).not.toMatch(/\[__\]/);
  });

  it('lo que depende del negocio queda entre corchetes y el constructor lo detecta', () => {
    expect(termsHasPlaceholders(DEFAULT_TERMS_HTML)).toBe(true);
    expect(DEFAULT_TERMS_HTML.match(/\[[^\]]*\]/g)).toEqual(['[razón social legal]']);
    expect(termsHasPlaceholders(DEFAULT_TERMS_HTML.replace(/\[[^\]]*\]/g, 'X'))).toBe(false);
  });

  it('el HTML es seguro: sin etiquetas fuera de h2, p, em, ul y li', () => {
    const tags = new Set(Array.from(DEFAULT_TERMS_HTML.matchAll(/<\/?([a-z0-9]+)/g)).map((m) => m[1]));
    expect([...tags].sort()).toEqual(['em', 'h2', 'li', 'p', 'ul']);
    expect(DEFAULT_TERMS_HTML).toContain('T&amp;C');
  });
});
