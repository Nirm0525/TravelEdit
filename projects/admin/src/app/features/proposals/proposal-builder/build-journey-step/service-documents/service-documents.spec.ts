import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ServiceDocuments } from './service-documents';
import { ProposalServiceAttachmentsService } from '../../../../../core/services/proposal-service-attachments';
import { AttachmentApiError, ProposalServiceAttachment } from '../../../../../core/models/proposal-service-attachment.model';

const att = (id: string, over: Partial<ProposalServiceAttachment> = {}): ProposalServiceAttachment => ({
  id, proposalId: 'p1', serviceId: 's1', fileName: `${id}.pdf`, mimeType: 'application/pdf', fileSize: 2048,
  visibleToClient: false, createdAt: 't', updatedAt: 't', ...over
});
const pdf = (name = 'nuevo.pdf') => new File([new Uint8Array([1])], name, { type: 'application/pdf' });

/** Promesa que se resuelve a mano: sirve para ver el estado "subiendo" a mitad de camino. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('ServiceDocuments', () => {
  let service: Record<'upload' | 'setVisibility' | 'delete' | 'getUrl', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<ServiceDocuments>;
  let emitted: ProposalServiceAttachment[][];

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const button = (label: string, scope: ParentNode = el()) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const picker = (index: 0 | 1) => el().querySelectorAll('input[type="file"]')[index] as HTMLInputElement;
  const choose = (input: HTMLInputElement, files: File[]) => {
    Object.defineProperty(input, 'files', { value: files, configurable: true });
    input.dispatchEvent(new Event('change'));
  };

  function create(attachments: ProposalServiceAttachment[] = []): void {
    fixture = TestBed.createComponent(ServiceDocuments);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.componentRef.setInput('serviceId', 's1');
    fixture.componentRef.setInput('attachments', attachments);
    emitted = [];
    fixture.componentInstance.changed.subscribe((list) => emitted.push(list));
    fixture.detectChanges();
  }

  beforeEach(() => {
    service = {
      upload: vi.fn(),
      setVisibility: vi.fn(),
      delete: vi.fn().mockResolvedValue(undefined),
      getUrl: vi.fn().mockResolvedValue('https://signed.test/doc')
    };
    TestBed.configureTestingModule({ providers: [{ provide: ProposalServiceAttachmentsService, useValue: service }] });
  });

  it('muestra la sección "Documentos del servicio" con el botón de adjuntar, separada de la imagen', () => {
    create();
    expect(text()).toContain('Documentos del servicio');
    expect(button('+ Adjuntar archivo')).toBeTruthy();
    expect(text()).toContain('Sin documentos');
    expect(text()).not.toContain('Elegir imagen');
  });

  it('lista cada documento con su nombre, tamaño y el control «Visible para el cliente» (desmarcado por defecto)', () => {
    create([att('a', { fileName: 'Boleto aéreo CM385.pdf' }), att('b', { visibleToClient: true })]);
    const items = el().querySelectorAll('.service-docs__item');
    expect(items.length).toBe(2);
    expect(items[0].textContent).toContain('Boleto aéreo CM385.pdf');
    expect(items[0].textContent).toContain('2 KB');
    const boxes = el().querySelectorAll<HTMLInputElement>('.service-docs__visible input');
    expect([boxes[0].checked, boxes[1].checked]).toEqual([false, true]);
    for (const label of ['Abrir', 'Descargar', 'Reemplazar', 'Eliminar']) {
      expect(button(label, items[0])).toBeTruthy();
    }
  });

  it('subir: muestra el estado de carga, bloquea el botón (sin doble upload) y emite la lista nueva', async () => {
    const pending = deferred<ProposalServiceAttachment>();
    service.upload.mockImplementation((_p: string, _s: string, _f: File, opts: { onPhase: (p: string) => void }) => {
      opts.onPhase('uploading');
      return pending.promise;
    });
    create([att('a')]);
    choose(picker(0), [pdf('nuevo.pdf')]);
    await settle();
    expect(text()).toContain('Subiendo… nuevo.pdf');
    expect(button('+ Adjuntar archivo')!.disabled).toBe(true);
    choose(picker(0), [pdf('otro.pdf')]); // segundo intento mientras sube
    await settle();
    expect(service.upload).toHaveBeenCalledTimes(1);

    pending.resolve(att('n', { fileName: 'nuevo.pdf' }));
    await settle();
    expect(emitted.at(-1)!.map((a) => a.id)).toEqual(['a', 'n']);
    expect(text()).not.toContain('Subiendo');
    expect(button('+ Adjuntar archivo')!.disabled).toBe(false);
    expect(service.upload.mock.calls[0].slice(0, 3)).toEqual(['p1', 's1', expect.any(File)]);
  });

  it('subir varios archivos: sube en orden y avisa de los que fallan sin perder los buenos', async () => {
    service.upload
      .mockResolvedValueOnce(att('n1', { fileName: 'uno.pdf' }))
      .mockRejectedValueOnce(new AttachmentApiError('El contenido del archivo no coincide con su tipo.', 'invalid_file_type'));
    create();
    choose(picker(0), [pdf('uno.pdf'), pdf('dos.pdf'), new File(['x'], 'malo.exe', { type: 'application/x-msdownload' })]);
    await settle();
    expect(emitted.at(-1)!.map((a) => a.id)).toEqual(['n1']);
    expect(text()).toContain('dos.pdf: El contenido del archivo no coincide');
    expect(text()).toContain('malo.exe: Tipo de archivo no permitido');
    expect(service.upload).toHaveBeenCalledTimes(2);
  });

  it('error de subida: muestra el mensaje y no emite cambios', async () => {
    service.upload.mockRejectedValue(new AttachmentApiError('Cada servicio admite hasta 10 documentos.', 'too_many_files'));
    create();
    choose(picker(0), [pdf()]);
    await settle();
    expect(el().querySelector('[role="alert"]')?.textContent).toContain('Cada servicio admite hasta 10 documentos.');
    expect(emitted).toEqual([]);
  });

  it('no deja adjuntar más de 10 por servicio', () => {
    create(Array.from({ length: 10 }, (_, i) => att(`d${i}`)));
    expect(button('+ Adjuntar archivo')!.disabled).toBe(true);
    expect(text()).toContain('máximo de 10 documentos');
  });

  it('reemplazar: sube con replaceId y actualiza ese documento; si falla, avisa que el anterior sigue disponible', async () => {
    service.upload.mockResolvedValueOnce(att('a', { fileName: 'nuevo.pdf', fileSize: 99 }));
    create([att('a'), att('b')]);
    const clickSpy = vi.spyOn(picker(1), 'click').mockImplementation(() => undefined);
    button('Reemplazar', el().querySelectorAll('.service-docs__item')[0])!.click();
    expect(clickSpy).toHaveBeenCalled();
    choose(picker(1), [pdf('nuevo.pdf')]);
    await settle();
    expect(service.upload.mock.calls[0][3]).toMatchObject({ replaceId: 'a' });
    expect(emitted.at(-1)!.map((a) => [a.id, a.fileName])).toEqual([['a', 'nuevo.pdf'], ['b', 'b.pdf']]);

    service.upload.mockRejectedValueOnce(new AttachmentApiError('El contenido del archivo no coincide con su tipo.', 'invalid_file_type'));
    emitted = [];
    button('Reemplazar', el().querySelectorAll('.service-docs__item')[1])!.click();
    choose(picker(1), [pdf('malo.pdf')]);
    await settle();
    expect(emitted).toEqual([]);
    expect(text()).toContain('El archivo anterior sigue disponible');
  });

  it('eliminar: pide confirmación, no borra hasta confirmar y quita el documento de la lista', async () => {
    create([att('a'), att('b')]);
    button('Eliminar', el().querySelectorAll('.service-docs__item')[0])!.click();
    await settle();
    expect(document.body.textContent).toContain('Eliminar documento');
    expect(service.delete).not.toHaveBeenCalled();

    const confirmButton = Array.from(el().querySelectorAll('.btn--danger')).find((b) => b.textContent?.trim() === 'Eliminar') as HTMLButtonElement;
    confirmButton.click();
    await settle();
    expect(service.delete).toHaveBeenCalledWith('a');
    expect(emitted.at(-1)!.map((x) => x.id)).toEqual(['b']);
  });

  it('eliminar cancelado no llama al servidor; si el borrado falla, el documento sigue y se muestra el error', async () => {
    create([att('a')]);
    button('Eliminar', el().querySelectorAll('.service-docs__item')[0])!.click();
    await settle();
    (Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Cancelar') as HTMLButtonElement).click();
    await settle();
    expect(service.delete).not.toHaveBeenCalled();

    service.delete.mockRejectedValueOnce(new AttachmentApiError('No se pudo eliminar el archivo. El documento sigue en la lista.', 'storage_failed'));
    button('Eliminar', el().querySelectorAll('.service-docs__item')[0])!.click();
    await settle();
    (el().querySelector('.btn--danger') as HTMLButtonElement).click();
    await settle();
    expect(emitted).toEqual([]);
    expect(text()).toContain('No se pudo eliminar «a.pdf»');
  });

  it('visibilidad: el interruptor llama al servidor y emite el documento actualizado; si falla, vuelve atrás', async () => {
    service.setVisibility.mockResolvedValueOnce(att('a', { visibleToClient: true }));
    create([att('a')]);
    const box = el().querySelector<HTMLInputElement>('.service-docs__visible input')!;
    box.checked = true;
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(service.setVisibility).toHaveBeenCalledWith('a', true);
    expect(emitted.at(-1)![0].visibleToClient).toBe(true);

    service.setVisibility.mockRejectedValueOnce(new AttachmentApiError('No se pudo.', 'x'));
    emitted = [];
    box.checked = true; // el padre aún no actualizó el input: sigue en false
    box.dispatchEvent(new Event('change'));
    await settle();
    expect(box.checked).toBe(false);
    expect(emitted).toEqual([]);
    expect(text()).toContain('No se pudo cambiar la visibilidad');
  });

  it('abrir: pide una URL firmada (nunca usa una guardada) y la abre en la pestaña ya abierta', async () => {
    const tab = { opener: 'x', location: { href: '' }, close: vi.fn() };
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
    create([att('a')]);
    button('Abrir')!.click();
    await settle();
    expect(openSpy).toHaveBeenCalledWith('', '_blank');
    expect(service.getUrl).toHaveBeenCalledWith('a', false);
    expect(tab.location.href).toBe('https://signed.test/doc');
    expect(tab.opener).toBeNull();

    service.getUrl.mockRejectedValueOnce(new AttachmentApiError('No se encontró el documento.', 'not_found'));
    button('Abrir')!.click();
    await settle();
    expect(tab.close).toHaveBeenCalled();
    expect(text()).toContain('No se pudo abrir el documento');
    openSpy.mockRestore();
  });

  it('abrir no expone rutas de Storage: el componente solo maneja ids y nombres', () => {
    create([att('a')]);
    expect(el().innerHTML).not.toContain('storage');
    expect(el().innerHTML).not.toContain('signed');
  });
});
