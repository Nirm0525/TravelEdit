import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { LeadDetail } from './lead-detail';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { ProfilesService } from '../../../core/services/profiles';
import { AuditLogService } from '../../../core/services/audit-log';
import { ProposalsService } from '../../../core/services/proposals';

const lead = { id: 'L1', name: 'Ana', destinationInterestText: 'Chile', details: { adults: 2, children: 1, departureDate: '2027-03-01', returnDate: '2027-03-10' } };

describe('LeadDetail — «Propuesta» de la solicitud', () => {
  let proposals: { findByLeadId: ReturnType<typeof vi.fn>; createDraft: ReturnType<typeof vi.fn> };
  let navigate: ReturnType<typeof vi.spyOn>;

  async function create(existing: unknown = null): Promise<LeadDetail> {
    proposals = {
      findByLeadId: vi.fn().mockResolvedValue(existing),
      createDraft: vi.fn().mockResolvedValue({ id: 'new-1' })
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'L1' }) } } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(lead), listNotes: vi.fn().mockResolvedValue([]) } },
        { provide: AuthService, useValue: { isAdmin: signal(true), profile: () => ({ role: 'admin' }) } },
        { provide: ProfilesService, useValue: { nameMap: vi.fn().mockResolvedValue(new Map()) } },
        { provide: AuditLogService, useValue: { listByEntity: vi.fn().mockResolvedValue([]) } },
        { provide: ProposalsService, useValue: proposals }
      ]
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const component = TestBed.runInInjectionContext(() => new LeadDetail());
    for (let i = 0; i < 5; i++) {
      await Promise.resolve();
    }
    return component;
  }

  it('busca la propuesta vinculada con findByLeadId (que filtra kind = proposal) y no un itinerario', async () => {
    await create();
    expect(proposals.findByLeadId).toHaveBeenCalledWith('L1');
  });

  it('crear la propuesta desde la solicitud envía kind = proposal y navega a /viajes/propuestas', async () => {
    const component = await create();
    await component.onProposalCta();
    expect(proposals.createDraft).toHaveBeenCalledTimes(1);
    expect(proposals.createDraft.mock.calls[0][0]).toMatchObject({ kind: 'proposal', clientName: 'Ana', leadId: 'L1', travelersCount: 3 });
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'new-1', 'edit']);
  });

  it('con una propuesta vinculada no crea otra: navega a ella por la ruta de propuestas', async () => {
    const component = await create({ id: 'existing-1', kind: 'proposal' });
    await component.onProposalCta();
    expect(proposals.createDraft).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'existing-1', 'edit']);
  });
});
