import { TestBed } from '@angular/core/testing';
import { DashboardService } from './dashboard';
import { SupabaseService } from './supabase';
import { AuditLogService } from './audit-log';

/** Cliente falso: registra cada consulta; las de `proposals` devuelven filas mezcladas para comprobar que el filtro va en la consulta. */
function setup() {
  const queries: { table: string; eqs: [string, unknown][] }[] = [];
  const client = {
    from: (table: string) => {
      const q = { table, eqs: [] as [string, unknown][] };
      queries.push(q);
      const builder: Record<string, unknown> = {};
      for (const name of ['select', 'order', 'limit', 'gte']) {
        builder[name] = () => builder;
      }
      builder['eq'] = (column: string, value: unknown) => {
        q.eqs.push([column, value]);
        return builder;
      };
      builder['then'] = (resolve: (v: unknown) => unknown) =>
        Promise.resolve({
          data: table === 'proposals'
            ? [{ id: 'p1', client_name: 'Ana', title: null, status: 'draft', updated_at: 't', feedback_sent_at: null, service_comments: {} }]
            : [],
          count: 0,
          error: null
        }).then(resolve);
      return builder;
    }
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: SupabaseService, useValue: { client } },
      { provide: AuditLogService, useValue: { listRecent: async () => [] } }
    ]
  });
  return { service: TestBed.inject(DashboardService), queries };
}

describe('DashboardService — «Propuestas» no mezcla itinerarios', () => {
  it('el dashboard de la asesora consulta proposals con kind = proposal', async () => {
    const { service, queries } = setup();
    const data = await service.loadAdvisor();
    const proposalQueries = queries.filter((q) => q.table === 'proposals');
    expect(proposalQueries).toHaveLength(1);
    expect(proposalQueries[0].eqs).toContainEqual(['kind', 'proposal']);
    expect(data.recentProposals.map((p) => p.id)).toEqual(['p1']);
  });

  it('ninguna consulta del dashboard lee proposals sin filtrar por tipo', async () => {
    const { service, queries } = setup();
    await service.loadAdvisor();
    await service.load();
    for (const q of queries.filter((x) => x.table === 'proposals')) {
      expect(q.eqs.some(([c]) => c === 'kind')).toBe(true);
    }
  });
});
