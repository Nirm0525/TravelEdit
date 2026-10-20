import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProposalServiceDocuments, documentDisplayName } from './proposal-service-documents';
import { ProposalDocument } from '../../../core/services/public-proposal';

const doc = (id: string, name: string): ProposalDocument => ({ id, serviceId: 's1', name, mimeType: 'application/pdf' });

describe('ProposalServiceDocuments (propuesta privada)', () => {
  let fixture: ComponentFixture<ProposalServiceDocuments>;
  const el = () => fixture.nativeElement as HTMLElement;

  function create(documents: ProposalDocument[], busyId: string | null = null): void {
    fixture = TestBed.createComponent(ProposalServiceDocuments);
    fixture.componentRef.setInput('documents', documents);
    fixture.componentRef.setInput('busyId', busyId);
    fixture.detectChanges();
  }

  it('sin documentos visibles no pinta nada (ni el título)', () => {
    create([]);
    expect(el().textContent?.trim()).toBe('');
    expect(el().querySelector('.proposal-docs')).toBeNull();
  });

  it('muestra DOCUMENTOS con el nombre sin extensión y «Ver documento →» por cada uno', () => {
    create([doc('1', 'Boleto aéreo CM385.pdf'), doc('2', 'Confirmación de hotel.pdf')]);
    const text = el().textContent?.replace(/\s+/g, ' ') ?? '';
    expect(text).toContain('Documentos');
    expect(text).toContain('Boleto aéreo CM385');
    expect(text).not.toContain('CM385.pdf');
    expect(text).toContain('Confirmación de hotel');
    expect(el().querySelectorAll('.proposal-docs__link').length).toBe(2);
    expect(el().querySelector('.proposal-docs__link')?.textContent?.trim()).toBe('Ver documento →');
  });

  it('abrir emite el documento elegido (la URL firmada la pide quien lo recibe)', () => {
    create([doc('1', 'Uno.pdf'), doc('2', 'Dos.pdf')]);
    const opened: ProposalDocument[] = [];
    fixture.componentInstance.openDocument.subscribe((d) => opened.push(d));
    (el().querySelectorAll('.proposal-docs__link')[1] as HTMLButtonElement).click();
    expect(opened.map((d) => d.id)).toEqual(['2']);
  });

  it('mientras se abre un documento su enlace se bloquea y cambia el texto', () => {
    create([doc('1', 'Uno.pdf'), doc('2', 'Dos.pdf')], '1');
    const links = Array.from(el().querySelectorAll<HTMLButtonElement>('.proposal-docs__link'));
    expect(links[0].disabled).toBe(true);
    expect(links[0].textContent?.trim()).toBe('Abriendo…');
    expect(links[1].disabled).toBe(false);
  });

  it('no expone nada interno: el HTML solo lleva nombres (sin ids, rutas ni metadata)', () => {
    create([doc('11111111-1111-4111-8111-111111111111', 'Boleto.pdf')]);
    const html = el().innerHTML;
    expect(html).not.toContain('11111111-1111');
    expect(html).not.toContain('storage');
    expect(html).not.toContain('application/pdf');
    expect(html).not.toContain('href');
  });

  it('documentDisplayName: quita la extensión y no deja el nombre vacío', () => {
    expect(documentDisplayName('Boleto aéreo CM385.pdf')).toBe('Boleto aéreo CM385');
    expect(documentDisplayName('foto.JPEG')).toBe('foto');
    expect(documentDisplayName('.pdf')).toBe('.pdf');
  });
});
