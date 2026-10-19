import { ComponentFixture, TestBed } from '@angular/core/testing';
import { PublishChecklist } from './publish-checklist';
import { PublishProblem } from '../../../../core/models/publish-readiness';

const problem = (over: Partial<PublishProblem>): PublishProblem => ({
  position: 1, code: 'cover_title_missing', message: 'Portada: falta el título.', tab: 'cover', day_id: null, service_id: null, line_id: null, ...over
});

describe('PublishChecklist', () => {
  let fixture: ComponentFixture<PublishChecklist>;
  const el = () => fixture.nativeElement as HTMLElement;

  function render(problems: PublishProblem[]): void {
    fixture = TestBed.createComponent(PublishChecklist);
    fixture.componentRef.setInput('problems', problems);
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PublishChecklist] }).compileComponents();
  });

  it('no muestra nada si no falta nada', () => {
    render([]);
    expect(el().querySelector('#publish-checklist')).toBeNull();
  });

  it('lista TODOS los pendientes, no solo el primero, con el título que dice cuántos son', () => {
    render([
      problem({ position: 1 }),
      problem({ position: 2, code: 'days_missing', message: 'Itinerario: no hay ningún día. Agrega al menos uno.', tab: 'journey' }),
      problem({ position: 3, code: 'access_code_missing', message: 'Acceso: falta generar el código de acceso.', tab: 'client-trip' })
    ]);
    const items = Array.from(el().querySelectorAll('.publish-checklist__item')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
    expect(items.length).toBe(3);
    expect(items[0]).toContain('Portada: falta el título.');
    expect(items[1]).toContain('Itinerario: no hay ningún día. Agrega al menos uno.');
    expect(items[2]).toContain('Acceso: falta generar el código de acceso.');
    expect(el().querySelector('.publish-checklist__title')?.textContent).toContain('Faltan 3 datos para publicar');
  });

  it('con un solo pendiente el título va en singular', () => {
    render([problem({})]);
    expect(el().querySelector('.publish-checklist__title')?.textContent).toContain('Falta 1 dato para publicar');
  });

  it('cada punto es un botón que emite el problema para abrir su pestaña', () => {
    render([problem({ position: 1 }), problem({ position: 2, code: 'price_lines_missing', message: 'Precios: no hay ninguna línea de precio.', tab: 'pricing' })]);
    const emitted: PublishProblem[] = [];
    fixture.componentInstance.selected.subscribe((p) => emitted.push(p));
    (el().querySelectorAll('.publish-checklist__item')[1] as HTMLButtonElement).click();
    expect(emitted.map((p) => [p.code, p.tab])).toEqual([['price_lines_missing', 'pricing']]);
  });

  it('es accesible: región con nombre, anunciada al cambiar y enfocable desde el botón de publicar', () => {
    render([problem({})]);
    const section = el().querySelector('#publish-checklist') as HTMLElement;
    expect(section.getAttribute('aria-live')).toBe('polite');
    expect(section.getAttribute('aria-labelledby')).toBe('publish-checklist-title');
    expect(section.tabIndex).toBe(-1);
  });

  it('se actualiza al cambiar los pendientes (mientras la asesora completa los datos)', () => {
    render([problem({}), problem({ position: 2, code: 'days_missing', message: 'Itinerario: no hay ningún día.', tab: 'journey' })]);
    expect(el().querySelectorAll('.publish-checklist__item').length).toBe(2);
    fixture.componentRef.setInput('problems', [problem({ position: 2, code: 'days_missing', message: 'Itinerario: no hay ningún día.', tab: 'journey' })]);
    fixture.detectChanges();
    expect(el().querySelectorAll('.publish-checklist__item').length).toBe(1);
    fixture.componentRef.setInput('problems', []);
    fixture.detectChanges();
    expect(el().querySelector('#publish-checklist')).toBeNull();
  });
});
