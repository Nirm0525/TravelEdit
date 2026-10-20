import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PublicProposalService } from './public-proposal';
import { SupabaseService } from './supabase';

const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';

describe('PublicProposalService — documentos', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let service: PublicProposalService;

  beforeEach(() => {
    invoke = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client: { functions: { invoke } } } }] });
    service = TestBed.inject(PublicProposalService);
  });

  it('lista: llama a proposal-documents con el token y la sesión y devuelve solo id, servicio, nombre y tipo', async () => {
    invoke.mockResolvedValue({
      data: { documents: [{ id: 'd1', serviceId: 's1', name: 'Boleto.pdf', mimeType: 'application/pdf' }] },
      error: null
    });
    const docs = await service.getDocuments(TOKEN, SESSION);
    expect(invoke).toHaveBeenCalledWith('proposal-documents', { body: { action: 'list', token: TOKEN, sessionToken: SESSION } });
    expect(docs).toEqual([{ id: 'd1', serviceId: 's1', name: 'Boleto.pdf', mimeType: 'application/pdf' }]);
  });

  it('lista: si la función falla o responde basura, la propuesta sigue sin documentos (sin romper)', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('404') });
    expect(await service.getDocuments(TOKEN, SESSION)).toEqual([]);
    invoke.mockResolvedValueOnce({ data: { documents: 'nada' }, error: null });
    expect(await service.getDocuments(TOKEN, SESSION)).toEqual([]);
    invoke.mockRejectedValueOnce(new Error('red'));
    expect(await service.getDocuments(TOKEN, SESSION)).toEqual([]);
    invoke.mockResolvedValueOnce({ data: { documents: [{ id: 1 }, { id: 'ok', serviceId: 's', name: 'a.pdf', mimeType: 'application/pdf' }] }, error: null });
    expect((await service.getDocuments(TOKEN, SESSION)).map((d) => d.id)).toEqual(['ok']);
  });

  it('abrir: pide la URL firmada de UN documento con token, sesión e id', async () => {
    invoke.mockResolvedValue({ data: { url: 'https://signed.test/doc?token=abc', expiresInSeconds: 600 }, error: null });
    expect(await service.getDocumentUrl(TOKEN, SESSION, 'd1')).toBe('https://signed.test/doc?token=abc');
    expect(invoke).toHaveBeenCalledWith('proposal-documents', { body: { action: 'url', token: TOKEN, sessionToken: SESSION, attachmentId: 'd1' } });
  });

  it('abrir: un 404 (documento no visible, sesión de otra propuesta…) lanza un error claro, sin detalles', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { status: 404 } } });
    await expect(service.getDocumentUrl(TOKEN, SESSION, 'd1')).rejects.toThrow('No se pudo abrir el documento.');
    invoke.mockResolvedValue({ data: {}, error: null });
    await expect(service.getDocumentUrl(TOKEN, SESSION, 'd1')).rejects.toThrow('No se pudo abrir el documento.');
  });
});
