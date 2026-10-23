import { sanitizeRichHtml } from './sanitize-rich-html';

// Mismo contenido en projects/admin/src/app/core/utils/sanitize-rich-html.spec.ts: los dos espejos deben comportarse igual.
describe('sanitizeRichHtml', () => {
  it('conserva el texto de las listas de tareas del editor (va dentro de un <div>)', () => {
    const html =
      '<ul data-type="taskList"><li data-checked="true" data-type="taskItem"><label><input type="checkbox" checked="checked"><span></span></label><div><p>Pasaporte</p></div></li></ul>';
    const out = sanitizeRichHtml(html);
    expect(out).toContain('Pasaporte');
    expect(out).toContain('data-type="taskItem"');
    expect(out).toContain('data-checked="true"');
    expect(out).toContain('type="checkbox"');
  });

  it('conserva las celdas combinadas de las tablas', () => {
    const out = sanitizeRichHtml('<table><tbody><tr><th colspan="2" rowspan="1"><p>Cabecera</p></th></tr></tbody></table>');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('rowspan="1"');
  });

  it('conserva formato, alineación y colores permitidos', () => {
    const out = sanitizeRichHtml('<p style="text-align: center; color: #7A2338"><strong>a</strong><em>b</em><u>c</u><s>d</s></p>');
    expect(out).toContain('text-align: center');
    expect(out).toContain('color: #7A2338');
    for (const tag of ['strong', 'em', 'u', 's']) {
      expect(out).toContain(`<${tag}>`);
    }
  });

  it('elimina scripts, iframes, estilos, manejadores, javascript: y CSS peligroso', () => {
    const out = sanitizeRichHtml(
      '<p>Seguro</p><script>1</script><iframe src="https://x.test"></iframe><style>a{}</style><img src="x" onerror="1"><a href="javascript:alert(1)">m</a>' +
        '<p onclick="1" style="color: red; background-image: url(javascript:1); position: fixed">e</p><div onmouseover="1">d</div>'
    );
    expect(out).toContain('Seguro');
    for (const bad of ['<script', '<iframe', '<style', 'onerror', 'onclick', 'onmouseover', 'javascript:', 'url(', 'position']) {
      expect(out, bad).not.toContain(bad);
    }
  });
});
