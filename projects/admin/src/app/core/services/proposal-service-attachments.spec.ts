import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ProposalServiceAttachmentsService } from './proposal-service-attachments';
import { SupabaseService } from './supabase';
import { AttachmentApiError } from '../models/proposal-service-attachment.model';

const P = '11111111-1111-4111-8111-111111111111';
const S = '22222222-2222-4222-8222-222222222222';
const SERVER_PATH = `${P}/${S}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;

const view = (over: Record<string, unknown> = {}) => ({
  id: 'att-1', proposalId: P, serviceId: S, fileName: 'Boleto.pdf', mimeType: 'application/pdf', fileSize: 1000,
  visibleToClient: false, createdAt: 't', updatedAt: 't', ...over
});
const pdf = (name = 'Boleto.pdf', size = 1000) => {
  const f = new File([new Uint8Array(1)], name, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('ProposalServiceAttachmentsService', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let uploadToSignedUrl: ReturnType<typeof vi.fn>;
  let order: string[];
  let service: ProposalServiceAttachmentsService;

  beforeEach(() => {
    order = [];
    invoke = vi.fn(async (_name: string, opts: { body: Record<string, unknown> }) => {
      order.push(String(opts.body['action']));
      switch (opts.body['action']) {
        case 'prepare-upload':
          return { data: { storagePath: SERVER_PATH, token: 'tok', contentType: 'application/pdf' }, error: null };
        case 'finalize-upload':
          return { data: { attachment: view() }, error: null };
        default:
          return { data: {}, error: null };
      }
    });
    uploadToSignedUrl = vi.fn(async () => {
      order.push('storage-upload');
      return { data: {}, error: null };
    });
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: { client: { functions: { invoke }, storage: { from: () => ({ uploadToSignedUrl }) } } }
        }
      ]
    });
    service = TestBed.inject(ProposalServiceAttachmentsService);
  });

  it('subir: prepare → subida directa a Storage con la ruta DEL SERVIDOR → finalize', async () => {
    const phases: string[] = [];
    const result = await service.upload(P, S, pdf(), { onPhase: (p) => phases.push(p) });
    expect(order).toEqual(['prepare-upload', 'storage-upload', 'finalize-upload']);
    expect(phases).toEqual(['authorizing', 'uploading', 'finalizing']);
    expect(uploadToSignedUrl).toHaveBeenCalledWith(SERVER_PATH, 'tok', expect.any(File), { contentType: 'application/pdf', upsert: false });
    expect(invoke.mock.calls[1][1].body.storagePath).toBe(SERVER_PATH);
    expect(result.fileName).toBe('Boleto.pdf');
    // El nombre original viaja solo como metadata de prepare/finalize, nunca decide la ruta.
    expect(invoke.mock.calls[0][1].body).toMatchObject({ proposalId: P, serviceId: S, fileName: 'Boleto.pdf', mimeType: 'application/pdf' });
  });

  it('un archivo inválido se rechaza en el navegador sin llamar a ningún servidor', async () => {
    const bad = new File(['x'], 'malo.exe', { type: 'application/x-msdownload' });
    await expect(service.upload(P, S, bad)).rejects.toThrow('Tipo de archivo no permitido');
    expect(invoke).not.toHaveBeenCalled();
    expect(uploadToSignedUrl).not.toHaveBeenCalled();
    await expect(service.upload(P, S, pdf('grande.pdf', 11 * 1024 * 1024))).rejects.toThrow('máximo es 10 MB');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reemplazar envía replaceAttachmentId en prepare y en finalize', async () => {
    await service.upload(P, S, pdf(), { replaceId: 'att-1' });
    expect(invoke.mock.calls[0][1].body.replaceAttachmentId).toBe('att-1');
    expect(invoke.mock.calls[1][1].body.replaceAttachmentId).toBe('att-1');
  });

  it('si la subida a Storage falla no se finaliza y el error es claro', async () => {
    uploadToSignedUrl.mockResolvedValueOnce({ data: null, error: new Error('red') });
    await expect(service.upload(P, S, pdf())).rejects.toThrow('No se pudo subir el archivo');
    expect(order).toEqual(['prepare-upload']);
  });

  it('un error del servidor llega como AttachmentApiError con su código y mensaje', async () => {
    const body = { error: 'Cada servicio admite hasta 10 documentos.', code: 'too_many_files' };
    invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify(body), { status: 409 }) } });
    const err = await service.upload(P, S, pdf()).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentApiError);
    expect(err.code).toBe('too_many_files');
    expect(err.message).toBe('Cada servicio admite hasta 10 documentos.');
  });

  it('visibilidad, borrar y firmar usan la Edge Function', async () => {
    invoke.mockResolvedValueOnce({ data: { attachment: view({ visibleToClient: true }) }, error: null });
    expect((await service.setVisibility('att-1', true)).visibleToClient).toBe(true);
    expect(invoke.mock.calls[0][1].body).toEqual({ action: 'set-visibility', attachmentId: 'att-1', visible: true });

    await service.delete('att-1');
    expect(invoke.mock.calls[1][1].body).toEqual({ action: 'delete', attachmentId: 'att-1' });

    invoke.mockResolvedValueOnce({ data: { url: 'https://signed.test/x' }, error: null });
    expect(await service.getUrl('att-1')).toBe('https://signed.test/x');
    expect(invoke.mock.calls[2][1].body).toEqual({ action: 'sign', attachmentId: 'att-1', download: false });
  });

  it('borrar un servicio: sin confirmar confirm=false; con confirmación manda el recuento visto; devuelve el contenido normalizado', async () => {
    invoke.mockResolvedValueOnce({ data: { content: { days: [] }, deletedDocuments: 0 }, error: null });
    const first = await service.removeService(P, 'day-1', S);
    expect(invoke.mock.calls[0][1].body).toMatchObject({ action: 'remove-service', proposalId: P, dayId: 'day-1', serviceId: S, confirm: false });
    expect(first.content.days).toEqual([]);
    expect(first.content.cover).toBeDefined(); // normalizado con toProposalContent

    invoke.mockResolvedValueOnce({ data: { content: { days: [] }, deletedDocuments: 2 }, error: null });
    const second = await service.removeService(P, 'day-1', S, { expectedCount: 2 });
    expect(invoke.mock.calls[1][1].body).toMatchObject({ confirm: true, expectedCount: 2 });
    expect(second.deletedDocuments).toBe(2);
  });

  it('exige confirmación: el error trae el recuento de documentos', async () => {
    const body = { error: 'Hay documentos adjuntos.', code: 'confirmation_required', attachmentCount: 3 };
    invoke.mockResolvedValueOnce({ data: null, error: { context: new Response(JSON.stringify(body), { status: 409 }) } });
    const err = await service.removeDay(P, 'day-1').catch((e) => e);
    expect(err.code).toBe('confirmation_required');
    expect(err.attachmentCount).toBe(3);
  });

  it('purgeProposal llama a purge-proposal', async () => {
    await service.purgeProposal(P);
    expect(invoke.mock.calls[0][1].body).toEqual({ action: 'purge-proposal', proposalId: P });
  });
});
