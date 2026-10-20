import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PROPOSAL_DOCUMENTS_PURGED_MESSAGE, ProposalDocumentsPurgedError, ProposalsService } from './proposals';
import { ProposalServiceAttachmentsService } from './proposal-service-attachments';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';

const MESSAGE = 'Los documentos de la propuesta ya se eliminaron, pero no fue posible eliminar la propuesta. Vuelve a intentarlo.';

describe('ProposalsService.remove — propuesta con documentos adjuntos', () => {
  let order: string[];
  let remaining: { id: string }[];
  let deleteResults: ({ error: unknown } | Error)[];
  let attachments: { listForProposal: ReturnType<typeof vi.fn>; purgeProposal: ReturnType<typeof vi.fn> };
  let service: ProposalsService;

  beforeEach(() => {
    order = [];
    remaining = [{ id: 'doc-1' }, { id: 'doc-2' }];
    deleteResults = [{ error: null }];
    attachments = {
      listForProposal: vi.fn(async () => {
        order.push('list');
        return [...remaining];
      }),
      purgeProposal: vi.fn(async () => {
        order.push('purge');
        remaining = []; // Storage y metadata ya no tienen nada de esta propuesta
      })
    };
    const client = {
      from: () => ({
        delete: () => ({
          eq: async () => {
            order.push('delete');
            const next = deleteResults.shift() ?? { error: null };
            if (next instanceof Error) {
              throw next;
            }
            return next;
          }
        })
      })
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client } },
        { provide: AuthService, useValue: {} },
        { provide: ProposalServiceAttachmentsService, useValue: attachments }
      ]
    });
    service = TestBed.inject(ProposalsService);
  });

  it('el mensaje para el admin es exactamente el acordado', () => {
    expect(PROPOSAL_DOCUMENTS_PURGED_MESSAGE).toBe(MESSAGE);
    expect(new ProposalDocumentsPurgedError().message).toBe(MESSAGE);
  });

  it('con documentos: primero la purga (Storage + metadata) y recién después se elimina la propuesta', async () => {
    await service.remove('p1');
    expect(order).toEqual(['list', 'purge', 'delete']);
    expect(attachments.purgeProposal).toHaveBeenCalledWith('p1');
  });

  it('sin documentos no hay purga y se elimina directo', async () => {
    remaining = [];
    await service.remove('p1');
    expect(order).toEqual(['list', 'delete']);
    expect(attachments.purgeProposal).not.toHaveBeenCalled();
  });

  it('si la purga falla, la propuesta NO se elimina y el error original llega tal cual', async () => {
    attachments.purgeProposal.mockRejectedValueOnce(new Error('No se pudieron eliminar todos los documentos.'));
    await expect(service.remove('p1')).rejects.toThrow('No se pudieron eliminar todos los documentos.');
    expect(attachments.purgeProposal).toHaveBeenCalledTimes(1);
    expect(order).not.toContain('delete');
  });

  it('si la purga termina y falla el DELETE: error claro para el admin, sin intentar restaurar nada', async () => {
    deleteResults = [{ error: { message: 'timeout' } }];
    const err = await service.remove('p1').catch((e) => e);
    expect(err).toBeInstanceOf(ProposalDocumentsPurgedError);
    expect(err.message).toBe(MESSAGE);
    expect(order).toEqual(['list', 'purge', 'delete']);
    expect(attachments.purgeProposal).toHaveBeenCalledTimes(1); // nada se restaura ni se vuelve a purgar
  });

  it('también si el DELETE lanza una excepción (red caída) en vez de devolver un error', async () => {
    deleteResults = [new Error('Failed to fetch')];
    await expect(service.remove('p1')).rejects.toBeInstanceOf(ProposalDocumentsPurgedError);
  });

  it('reintentar funciona: ya no quedan documentos, no se vuelve a purgar y el DELETE se completa', async () => {
    deleteResults = [{ error: { message: 'timeout' } }, { error: null }];
    await expect(service.remove('p1')).rejects.toBeInstanceOf(ProposalDocumentsPurgedError);
    order.length = 0;

    await service.remove('p1');
    expect(order).toEqual(['list', 'delete']);
    expect(attachments.purgeProposal).toHaveBeenCalledTimes(1);
  });

  it('sin documentos, un fallo del DELETE conserva el error original (no se dice que se borraron documentos)', async () => {
    remaining = [];
    const original = { message: 'permission denied' };
    deleteResults = [{ error: original }];
    await expect(service.remove('p1')).rejects.toBe(original);
  });
});
