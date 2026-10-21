import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ProposalImportService } from './proposal-import';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';

describe('ProposalImportService — el tipo se envía solo al subir', () => {
  let inserted: Record<string, unknown>[];
  let selected: string[];
  let invoke: ReturnType<typeof vi.fn>;
  let service: ProposalImportService;

  beforeEach(() => {
    inserted = [];
    selected = [];
    invoke = vi.fn().mockResolvedValue({ data: { proposal_id: 'new-1' }, error: null });
    const client = {
      storage: { from: () => ({ upload: async () => ({ error: null }) }) },
      from: () => ({
        insert: (row: Record<string, unknown>) => {
          inserted.push(row);
          return { select: () => ({ single: async () => ({ data: { id: 'imp-1' }, error: null }) }) };
        },
        select: (columns: string) => {
          selected.push(columns);
          return { eq: () => ({ single: async () => ({ data: { id: 'imp-1', status: 'ready', kind: 'itinerary' }, error: null }) }) };
        }
      }),
      functions: { invoke }
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client } },
        { provide: AuthService, useValue: { profile: () => ({ id: 'user-1' }) } }
      ]
    });
    service = TestBed.inject(ProposalImportService);
  });

  const pdf = () => new File([new Uint8Array(10)], 'viaje.pdf', { type: 'application/pdf' });

  it('upload(proposal) inserta la importación con kind = proposal explícito', async () => {
    await service.upload(pdf(), 'proposal');
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ kind: 'proposal', mode: 'new', created_by: 'user-1' });
  });

  it('upload(itinerary) inserta la importación con kind = itinerary explícito (y solo modo new)', async () => {
    await service.upload(pdf(), 'itinerary');
    expect(inserted[0]).toMatchObject({ kind: 'itinerary', mode: 'new' });
    expect(inserted[0]).not.toHaveProperty('proposal_id');
  });

  it('start y apply NO mandan el tipo: el servidor lo lee de la fila', async () => {
    await service.start('imp-1');
    await service.apply('imp-1', 'web', null);
    for (const [, options] of invoke.mock.calls) {
      expect(options.body).not.toHaveProperty('kind');
    }
    expect(invoke.mock.calls.map((c) => c[0])).toEqual(['import-proposal-pdf', 'apply-proposal-import']);
  });

  it('el estado de la importación trae el kind guardado por la base', async () => {
    const status = await service.getStatus('imp-1');
    expect(selected[0]).toContain('kind');
    expect(status.kind).toBe('itinerary');
  });
});
