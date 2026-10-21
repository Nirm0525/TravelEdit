import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { LeadDetail } from './lead-detail';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { ProfilesService } from '../../../core/services/profiles';
import { AuditLogService } from '../../../core/services/audit-log';
import { SupabaseService } from '../../../core/services/supabase';
import { InMemorySupabase } from '../../../core/testing/in-memory-supabase';

const lead = {
  id: 'L1', name: 'Ana Pérez', email: 'ana@example.com', phone: null, destinationInterestId: null, destinationInterestText: 'Chile', origin: 'web',
  message: null, details: { adults: 2, children: 1, departureDate: '2027-03-01', returnDate: '2027-03-10' }, status: 'nueva', assignedTo: null,
  createdAt: '2027-01-01T00:00:00Z', updatedAt: '2027-01-01T00:00:00Z', emailStatus: 'sent', emailSentAt: null, emailError: null, proposalSubject: null,
  proposalMessage: null, proposalSentAt: null, proposalSentBy: null, proposalEmailStatus: null, proposalEmailError: null
};

/**
 * Lead Detail RENDERIZADO, con el ProposalsService REAL sobre una base en memoria: así se comprueba de punta a punta que
 * «la propuesta de la solicitud» nunca es un itinerario y que crear envía kind = 'proposal'.
 */
describe('LeadDetail (renderizado) — solo Propuestas', () => {
  let db: InMemorySupabase;
  let fixture: ComponentFixture<LeadDetail>;
  let navigate: ReturnType<typeof vi.spyOn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const cta = () => el().querySelector('.lead-detail__proposal-cta') as HTMLButtonElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  async function render(seed: (db: InMemorySupabase) => void = () => undefined): Promise<void> {
    db = new InMemorySupabase();
    seed(db);
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'L1' }) } } },
        { provide: SupabaseService, useValue: { client: db.client } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(lead), listNotes: vi.fn().mockResolvedValue([]) } },
        { provide: AuthService, useValue: { isAdmin: signal(true), profile: () => ({ id: 'admin-1', role: 'admin' }) } },
        { provide: ProfilesService, useValue: { nameMap: vi.fn().mockResolvedValue(new Map()), listStaff: vi.fn().mockResolvedValue([]) } },
        { provide: AuditLogService, useValue: { listByEntity: vi.fn().mockResolvedValue([]) } }
      ]
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    fixture = TestBed.createComponent(LeadDetail);
    fixture.detectChanges();
    await settle();
  }

  const proposalRow = (over: Record<string, unknown> = {}) => ({ id: 'prop-1', kind: 'proposal', lead_id: 'L1', client_name: 'Ana Pérez', status: 'draft', content: {}, ...over });
  const itineraryRow = (over: Record<string, unknown> = {}) => ({ id: 'itin-1', kind: 'itinerary', lead_id: 'L1', client_name: 'Ana Pérez', status: 'draft', content: {}, ...over });

  it('sin propuesta vinculada ofrece «Crear propuesta» (nunca «itinerario»)', async () => {
    await render();
    expect(cta().textContent).toContain('Crear propuesta');
    expect(text().toLowerCase()).not.toContain('itinerario');
  });

  it('un ITINERARIO vinculado a la misma solicitud NO cuenta como su propuesta: sigue diciendo «Crear propuesta»', async () => {
    await render((d) => d.tables['proposals'].push(...[itineraryRow()].map((r) => ({ updated_at: 'x', ...r }))));
    expect(cta().textContent).toContain('Crear propuesta');
    expect(cta().textContent).not.toContain('Continuar');
    expect(cta().textContent).not.toContain('Ver propuesta');
  });

  it('crear desde la solicitud inserta UNA fila con kind = proposal y abre Viajes > Propuestas', async () => {
    await render((d) => d.tables['proposals'].push({ updated_at: 'x', ...itineraryRow() }));
    cta().click();
    await settle();
    const inserts = db.writes.filter((w) => w.table === 'proposals' && w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ kind: 'proposal', client_name: 'Ana Pérez', lead_id: 'L1' });
    const created = db.tables['proposals'].find((r) => r['id'] !== 'itin-1')!;
    expect(created['kind']).toBe('proposal');
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', created['id'], 'edit']);
    // El itinerario existente no se tocó.
    expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')).toMatchObject({ kind: 'itinerary', status: 'draft' });
  });

  it.each([
    ['draft', 'Continuar propuesta'],
    ['published', 'Ver propuesta'],
    ['accepted', 'Propuesta aceptada']
  ])('con una propuesta vinculada en %s muestra «%s» y navega a Viajes > Propuestas (no crea otra)', async (status, label) => {
    await render((d) => d.tables['proposals'].push({ updated_at: 'x', ...proposalRow({ status }) }));
    expect(cta().textContent).toContain(label);
    cta().click();
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'prop-1', 'edit']);
    expect(db.writes.filter((w) => w.op === 'insert')).toEqual([]);
  });

  it('con propuesta E itinerario vinculados, el botón apunta a la propuesta y el itinerario no se menciona', async () => {
    await render((d) => d.tables['proposals'].push({ updated_at: 'a', ...itineraryRow() }, { updated_at: 'b', ...proposalRow() }));
    cta().click();
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'prop-1', 'edit']);
    expect(text().toLowerCase()).not.toContain('itinerario');
    expect(el().querySelector('a[href*="/viajes/itinerarios"]')).toBeNull();
  });

  it('ningún enlace de la pantalla apunta a Itinerarios', async () => {
    await render();
    expect(Array.from(el().querySelectorAll('a')).map((a) => a.getAttribute('href') ?? '').filter((h) => h.includes('itinerarios'))).toEqual([]);
  });
});
