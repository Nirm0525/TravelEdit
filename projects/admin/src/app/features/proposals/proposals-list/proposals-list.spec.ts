import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalsList } from './proposals-list';
import { ProposalDocumentsPurgedError, ProposalsService } from '../../../core/services/proposals';
import { ProposalImagesService } from '../../../core/services/proposal-images';

const item = { id: 'p1', clientName: 'Persona Ejemplo', status: 'draft', serviceComments: {}, coverImagePath: null, content: {} };

describe('ProposalsList — eliminar propuesta', () => {
  let service: { list: ReturnType<typeof vi.fn>; countsByStatus: ReturnType<typeof vi.fn>; remove: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ProposalsList>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  beforeEach(async () => {
    service = {
      list: vi.fn().mockResolvedValue({ items: [item], total: 1 }),
      countsByStatus: vi.fn().mockResolvedValue({ draft: 1, published: 0, viewed: 0, accepted: 0, expired: 0 }),
      remove: vi.fn()
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ProposalsService, useValue: service },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } }
      ]
    });
    fixture = TestBed.createComponent(ProposalsList);
    fixture.detectChanges();
    await settle();
  });

  async function confirmDelete(): Promise<void> {
    fixture.componentInstance.proposalPendingDelete.set(item as never);
    await fixture.componentInstance.confirmDelete();
    await settle();
  }

  it('si los documentos ya se eliminaron pero falló el DELETE, el admin ve el mensaje claro y la lista se recarga', async () => {
    service.remove.mockRejectedValueOnce(new ProposalDocumentsPurgedError());
    const loads = service.list.mock.calls.length;
    await confirmDelete();
    expect(text()).toContain('Los documentos de la propuesta ya se eliminaron, pero no fue posible eliminar la propuesta. Vuelve a intentarlo.');
    expect(service.list.mock.calls.length).toBe(loads + 1);
  });

  it('cualquier otro error mantiene el mensaje genérico', async () => {
    service.remove.mockRejectedValueOnce(new Error('No se pudieron eliminar todos los documentos.'));
    await confirmDelete();
    expect(text()).toContain('No se pudo eliminar la propuesta. Inténtalo nuevamente.');
    expect(text()).not.toContain('ya se eliminaron');
  });

  it('al reintentar y salir bien, el aviso desaparece', async () => {
    service.remove.mockRejectedValueOnce(new ProposalDocumentsPurgedError()).mockResolvedValueOnce(undefined);
    await confirmDelete();
    expect(text()).toContain('ya se eliminaron');
    await confirmDelete();
    expect(text()).not.toContain('ya se eliminaron');
    expect(service.remove).toHaveBeenCalledTimes(2);
  });
});
