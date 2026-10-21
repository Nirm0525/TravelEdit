import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ProposalsService } from './proposals';
import { ProposalServiceAttachmentsService } from './proposal-service-attachments';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';

type Op = [string, ...unknown[]];

/** Cliente supabase-js falso y encadenable: registra cada consulta (tabla + operaciones) y devuelve `result` al esperarla. */
function fakeClient(result: { data?: unknown; count?: number | null; error?: unknown } = {}) {
  const queries: { table: string; ops: Op[] }[] = [];
  const client = {
    from: (table: string) => {
      const ops: Op[] = [];
      queries.push({ table, ops });
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'eq', 'order', 'range', 'or', 'limit', 'insert', 'update', 'delete']) {
        builder[name] = (...args: unknown[]) => {
          ops.push([name, ...args]);
          return builder;
        };
      }
      builder['maybeSingle'] = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      builder['single'] = () => Promise.resolve({ data: result.data ?? null, error: result.error ?? null });
      builder['then'] = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? [], count: result.count ?? 0, error: result.error ?? null }).then(resolve);
      return builder;
    }
  };
  return { client, queries };
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'p1', kind: 'proposal', public_token: 't', lead_id: null, status: 'draft', client_name: 'Ana', client_email: null, destination_text: null,
  start_date: null, end_date: null, travelers_count: null, advisor_id: null, currency: 'USD', access_required: true, content: {}, title: null,
  cover_image_path: null, pricing_subtotal: 0, pricing_fees: 0, pricing_total: 0, terms_accepted: false, accepted_at: null, accepted_by_name: null,
  service_choices: {}, service_comments: {}, feedback_sent_at: null, published_at: null, shared_at: null, viewed_at: null, expires_at: null,
  created_by: null, created_at: 't', updated_at: 't', ...over
});

describe('ProposalsService — consultas por kind', () => {
  function setup(result: Parameters<typeof fakeClient>[0] = {}) {
    const fake = fakeClient(result);
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client: fake.client } },
        { provide: AuthService, useValue: { profile: () => ({ id: 'u1' }) } },
        { provide: ProposalServiceAttachmentsService, useValue: {} }
      ]
    });
    return { service: TestBed.inject(ProposalsService), ...fake };
  }
  const eqs = (ops: Op[]) => ops.filter((o) => o[0] === 'eq').map((o) => [o[1], o[2]]);

  it('list proposal filtra kind = proposal EN LA CONSULTA (no en Angular)', async () => {
    const { service, queries } = setup({ data: [row()], count: 1 });
    const page = await service.list({ kind: 'proposal', page: 1, pageSize: 20 });
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe('proposals');
    expect(eqs(queries[0].ops)).toContainEqual(['kind', 'proposal']);
    expect(eqs(queries[0].ops)).not.toContainEqual(['kind', 'itinerary']);
    expect(page.total).toBe(1);
  });

  it('list itinerary filtra kind = itinerary EN LA CONSULTA', async () => {
    const { service, queries } = setup({ data: [row({ kind: 'itinerary' })], count: 1 });
    const page = await service.list({ kind: 'itinerary', page: 1, pageSize: 20 });
    expect(eqs(queries[0].ops)).toContainEqual(['kind', 'itinerary']);
    expect(page.items[0].kind).toBe('itinerary');
  });

  it('el filtro por estado se combina con kind (no lo reemplaza)', async () => {
    const { service, queries } = setup();
    await service.list({ kind: 'itinerary', page: 1, pageSize: 20, status: 'draft' });
    expect(eqs(queries[0].ops)).toEqual(expect.arrayContaining([['kind', 'itinerary'], ['status', 'draft']]));
  });

  it('la búsqueda por estado usa SOLO los estados y etiquetas de ese tipo', async () => {
    const itinerary = setup();
    await itinerary.service.list({ kind: 'itinerary', page: 1, pageSize: 20, search: 'compart' });
    const itineraryOr = String(itinerary.queries[0].ops.find((o) => o[0] === 'or')?.[1]);
    expect(itineraryOr).toContain('status.eq.shared');
    TestBed.resetTestingModule();

    const proposal = setup();
    await proposal.service.list({ kind: 'proposal', page: 1, pageSize: 20, search: 'compart' });
    expect(String(proposal.queries[0].ops.find((o) => o[0] === 'or')?.[1])).not.toContain('status.eq.shared');
    TestBed.resetTestingModule();

    const notShared = setup();
    await notShared.service.list({ kind: 'itinerary', page: 1, pageSize: 20, search: 'acept' });
    expect(String(notShared.queries[0].ops.find((o) => o[0] === 'or')?.[1])).not.toContain('status.eq.accepted');
  });

  it('countsByStatus(proposal): 5 conteos, todos con kind = proposal', async () => {
    const { service, queries } = setup({ count: 2 });
    const counts = await service.countsByStatus('proposal');
    expect(queries).toHaveLength(5);
    expect(queries.every((q) => eqs(q.ops).some(([c, v]) => c === 'kind' && v === 'proposal'))).toBe(true);
    expect(queries.map((q) => eqs(q.ops).find(([c]) => c === 'status')?.[1])).toEqual(['draft', 'published', 'viewed', 'accepted', 'expired']);
    expect(counts.published).toBe(2);
  });

  it('countsByStatus(itinerary): solo draft · shared · viewed, todos con kind = itinerary; nada de aceptadas ni publicadas', async () => {
    const { service, queries } = setup({ count: 4 });
    const counts = await service.countsByStatus('itinerary');
    expect(queries).toHaveLength(3);
    expect(queries.every((q) => eqs(q.ops).some(([c, v]) => c === 'kind' && v === 'itinerary'))).toBe(true);
    expect(queries.map((q) => eqs(q.ops).find(([c]) => c === 'status')?.[1])).toEqual(['draft', 'shared', 'viewed']);
    expect([counts.draft, counts.shared, counts.viewed, counts.accepted, counts.published, counts.expired]).toEqual([4, 4, 4, 0, 0, 0]);
  });

  it('createDraft proposal envía kind = proposal explícito, con los términos de partida', async () => {
    const { service, queries } = setup({ data: row() });
    await service.createDraft({ kind: 'proposal', clientName: 'Ana' });
    const payload = queries[0].ops.find((o) => o[0] === 'insert')?.[1] as Record<string, any>;
    expect(payload['kind']).toBe('proposal');
    expect(payload['content'].terms.body.length).toBeGreaterThan(0);
  });

  it('createDraft itinerary envía kind = itinerary explícito y un contenido SIN nada contractual ni moneda', async () => {
    const { service, queries } = setup({ data: row({ kind: 'itinerary' }) });
    await service.createDraft({ kind: 'itinerary', clientName: 'Ana', destinationText: 'Chile' });
    const payload = queries[0].ops.find((o) => o[0] === 'insert')?.[1] as Record<string, any>;
    expect(payload['kind']).toBe('itinerary');
    expect(payload).not.toHaveProperty('currency');
    const c = payload['content'];
    expect(c.terms).toEqual({ title: '', body: '' }); // sin términos de partida
    expect(c.pricing).toEqual({ lines: [], feesLines: [] }); // estructura segura, vacía
    expect(Object.keys(c).sort()).toEqual(['cover', 'days', 'intro', 'pricing', 'terms', 'travelTips', 'welcome']);
    expect(c.welcome.body).toBe('');
    expect(c.days).toEqual([]);
    expect(c.travelTips).toEqual([]);
  });

  it('findByLeadId («la propuesta de la solicitud») filtra kind = proposal: un itinerario no se confunde con ella', async () => {
    const { service, queries } = setup({ data: row() });
    await service.findByLeadId('lead-1');
    expect(eqs(queries[0].ops)).toEqual(expect.arrayContaining([['kind', 'proposal'], ['lead_id', 'lead-1']]));
  });

  it('getById lee por id de cualquier tipo y devuelve el kind REAL de la fila (la ruta no lo decide)', async () => {
    const { service, queries } = setup({ data: row({ kind: 'itinerary' }) });
    const found = await service.getById('p1');
    expect(eqs(queries[0].ops)).toEqual([['id', 'p1']]); // sin filtro por kind: así el editor puede detectar la discrepancia
    expect(found?.kind).toBe('itinerary');
  });

  it('un itinerario guardado sin términos no los recupera de partida al leerlo', async () => {
    const { service } = setup({ data: row({ kind: 'itinerary', content: {} }) });
    const found = await service.getById('p1');
    expect(found?.content.terms).toEqual({ title: '', body: '' });
  });
});
