import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalsList } from './proposals-list';
import { ProposalsService } from '../../../core/services/proposals';
import { ProposalImagesService } from '../../../core/services/proposal-images';
import { AuthService } from '../../../core/services/auth';
import { TravelMode } from '../../travel/travel-config';

const item = (kind: TravelMode, status: string, over: Record<string, unknown> = {}) => ({
  id: `${kind}-1`, kind, clientName: 'Persona Ejemplo', title: 'Viaje', status, serviceComments: { a: 'x' }, feedbackSentAt: null, coverImagePath: null,
  destinationText: null, startDate: null, travelersCount: null, content: {}, ...over
});

describe('ProposalsList — una lista, dos modos', () => {
  let service: { list: ReturnType<typeof vi.fn>; countsByStatus: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<ProposalsList>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const chips = () => Array.from(el().querySelectorAll('.proposals-list__filters button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  async function render(mode: TravelMode, role = 'admin', items: unknown[] = [item(mode, 'draft')]): Promise<void> {
    service = {
      list: vi.fn().mockResolvedValue({ items, total: items.length }),
      countsByStatus: vi.fn().mockResolvedValue({ draft: 1, shared: 2, published: 3, viewed: 4, accepted: 5, expired: 6 })
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { mode }, paramMap: { get: () => null } } } },
        { provide: ProposalsService, useValue: service },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: AuthService, useValue: { profile: () => ({ role }) } }
      ]
    });
    fixture = TestBed.createComponent(ProposalsList);
    fixture.detectChanges();
    await settle();
  }

  async function openMenu(): Promise<string> {
    (el().querySelector('.proposals-list__menu-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    return el().querySelector('.proposals-list__menu-panel')?.textContent?.replace(/\s+/g, ' ') ?? '';
  }

  it('propuestas: consulta y cuenta SOLO kind = proposal', async () => {
    await render('proposal');
    expect(service.list.mock.calls[0][0]).toMatchObject({ kind: 'proposal' });
    expect(service.countsByStatus).toHaveBeenCalledWith('proposal');
  });

  it('itinerarios: consulta y cuenta SOLO kind = itinerary', async () => {
    await render('itinerary');
    expect(service.list.mock.calls[0][0]).toMatchObject({ kind: 'itinerary' });
    expect(service.countsByStatus).toHaveBeenCalledWith('itinerary');
  });

  it('cada cambio de filtro o página vuelve a consultar con el mismo kind', async () => {
    await render('itinerary');
    await fixture.componentInstance.setStatusFilter('draft');
    await fixture.componentInstance.goToPage(2);
    expect(service.list.mock.calls.length).toBeGreaterThanOrEqual(3);
    for (const [params] of service.list.mock.calls) {
      expect(params.kind).toBe('itinerary');
    }
  });

  it('itinerarios: textos propios y solo sus estados (borrador · compartido · visto)', async () => {
    await render('itinerary');
    expect(text()).toContain('Itinerarios');
    expect(text()).toContain('Nuevo itinerario');
    expect(chips()).toEqual(['Todas 7', 'Borrador 1', 'Compartido 2', 'Visto por el cliente 4']);
  });

  it('itinerarios: el total suma solo sus estados — los conteos de propuestas no se mezclan', async () => {
    await render('itinerary');
    expect(fixture.componentInstance.totalCount()).toBe(1 + 2 + 4);
  });

  it('propuestas: conserva sus estados, «Nueva propuesta» y «Nueva desde PDF»', async () => {
    await render('proposal', 'staff');
    expect(chips()).toEqual(['Todas 19', 'Borrador 1', 'Publicada 3', 'Vista por el cliente 4', 'Aceptada 5', 'Expirada 6']);
    expect(text()).toContain('Nueva propuesta');
    expect(text()).toContain('Nueva desde PDF');
  });

  it('itinerarios: sin importar PDF, sin estado Aceptada ni precio', async () => {
    await render('itinerary', 'staff');
    for (const banned of ['Nueva desde PDF', 'Aceptada', 'Publicada', 'Precio', 'USD', 'Total']) {
      expect(text(), banned).not.toContain(banned);
    }
    expect(el().querySelector('a[href$="/import"]')).toBeNull();
  });

  it('itinerarios: el menú no ofrece Publicar, Despublicar ni Vista previa de propuesta', async () => {
    await render('itinerary', 'admin');
    const menu = await openMenu();
    expect(menu).toContain('Editar');
    for (const banned of ['Publicar', 'Despublicar', 'Vista previa']) {
      expect(menu, banned).not.toContain(banned);
    }
  });

  it('propuestas: el menú conserva Publicar en borrador y Vista previa', async () => {
    await render('proposal', 'admin');
    const menu = await openMenu();
    expect(menu).toContain('Publicar');
    expect(menu).toContain('Vista previa');
  });

  it('un itinerario compartido muestra «Compartido» y «Visto por el cliente», no etiquetas de propuesta', async () => {
    await render('itinerary', 'admin', [item('itinerary', 'shared', { id: 'i-a' }), item('itinerary', 'viewed', { id: 'i-b' })]);
    const badges = Array.from(el().querySelectorAll('.proposals-list__status-badge')).map((b) => b.textContent?.trim());
    expect(badges).toEqual(['Compartido', 'Visto por el cliente']);
  });

  it('«Cambios solicitados» (comentarios de cotización) no existe en itinerarios, aunque la fila traiga feedback', async () => {
    await render('itinerary', 'admin', [item('itinerary', 'draft', { feedbackSentAt: '2027-01-01T00:00:00Z' })]);
    expect(text()).not.toContain('Cambios solicitados');
    TestBed.resetTestingModule();
    await render('proposal', 'admin', [item('proposal', 'published', { feedbackSentAt: '2027-01-01T00:00:00Z' })]);
    expect(text()).toContain('Cambios solicitados');
  });

  it.each([
    ['proposal', 'admin', true],
    ['proposal', 'editor', false],
    ['proposal', 'staff', false],
    ['itinerary', 'admin', true],
    ['itinerary', 'editor', false],
    ['itinerary', 'staff', false]
  ] as const)('eliminar en %s: %s → %s (solo admin)', async (mode, role, allowed) => {
    await render(mode, role);
    const menu = await openMenu();
    expect(menu.includes('Eliminar')).toBe(allowed);
    expect(fixture.componentInstance.canRemove()).toBe(allowed);
  });

  it('el enlace de edición apunta a la ruta de SU modo', async () => {
    await render('itinerary');
    expect(el().querySelector('.proposals-list__row-link')?.getAttribute('href')).toContain('/viajes/itinerarios/itinerary-1/edit');
    TestBed.resetTestingModule();
    await render('proposal');
    expect(el().querySelector('.proposals-list__row-link')?.getAttribute('href')).toContain('/viajes/propuestas/proposal-1/edit');
  });
});
