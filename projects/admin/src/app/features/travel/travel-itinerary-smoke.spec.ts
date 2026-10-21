import { APP_BASE_HREF } from '@angular/common';
import { signal, Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { AdminSidebar } from '../../shared/ui/admin-sidebar/admin-sidebar';
import { ProposalsList } from '../proposals/proposals-list/proposals-list';
import { ProposalCreate } from '../proposals/proposal-create/proposal-create';
import { ProposalBuilder } from '../proposals/proposal-builder/proposal-builder';
import { AuthService } from '../../core/services/auth';
import { LeadsService } from '../../core/services/leads';
import { ProposalImagesService } from '../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../core/services/proposal-service-attachments';
import { SupabaseService } from '../../core/services/supabase';
import { InMemorySupabase } from '../../core/testing/in-memory-supabase';
import { ITINERARIES_ENABLED, TRAVEL_FEATURES, TravelMode } from './travel-config';

/**
 * Humo local de Itinerarios SIN base real: los servicios y componentes son los REALES; solo la base (supabase-js) es una
 * copia en memoria que imita lo que hace por defecto (kind = 'proposal' si no se envía). No hay credenciales ni datos de
 * producción. Lo que exige red (Edge Functions, Storage real, OpenAI) queda registrado como «llamada» pero no se ejecuta.
 */
describe('Humo — Itinerarios de punta a punta (base en memoria)', () => {
  let db: InMemorySupabase;
  let fixture: ComponentFixture<unknown>;
  let navigate: ReturnType<typeof vi.spyOn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 10; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  /** Monta un componente real contra la base en memoria compartida (db), con el modo y query params de la ruta indicada. */
  async function mount<T>(component: Type<T>, mode: TravelMode, opts: { id?: string; query?: Record<string, string>; role?: string; enabled?: boolean } = {}): Promise<T> {
    TestBed.resetTestingModule();
    window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener: () => undefined, removeEventListener: () => undefined, addListener: () => undefined, removeListener: () => undefined })) as never;
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: APP_BASE_HREF, useValue: '/admin/' },
        { provide: TRAVEL_FEATURES, useValue: { itinerariesEnabled: opts.enabled ?? true } },
        { provide: SupabaseService, useValue: { client: db.client } },
        { provide: AuthService, useValue: { isAdmin: signal(true), profile: signal({ id: 'u1', fullName: 'Asesora Demo', role: opts.role ?? 'admin' }), signOut: async () => undefined } },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null, upload: vi.fn(), remove: vi.fn() } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(null) } },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: { data: { mode }, paramMap: convertToParamMap(opts.id ? { id: opts.id } : {}), queryParamMap: convertToParamMap(opts.query ?? {}) }
          }
        }
      ]
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const created = TestBed.createComponent(component);
    fixture = created as ComponentFixture<unknown>;
    created.detectChanges();
    await settle();
    return created.componentInstance;
  }

  const tabs = () => Array.from(el().querySelectorAll('.proposal-builder__tab-label')).map((t) => t.textContent?.trim());
  const rows = () => Array.from(el().querySelectorAll('.proposals-list__row')).map((r) => r.querySelector('.proposals-list__client')?.textContent?.trim());
  const itineraries = () => db.tables['proposals'].filter((r) => r['kind'] === 'itinerary');

  beforeEach(() => {
    db = new InMemorySupabase();
  });

  it('el menú Viajes > Itinerarios sigue a la constante ITINERARIES_ENABLED (sin sobrescribir el flag)', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', children: [] }]),
        { provide: AuthService, useValue: { profile: signal({ role: 'admin', fullName: 'Asesora Demo' }), signOut: async () => undefined } }
      ]
    });
    localStorage.removeItem('travel-edit-admin-sidebar-collapsed');
    fixture = TestBed.createComponent(AdminSidebar) as ComponentFixture<unknown>;
    fixture.detectChanges();
    (el().querySelector('.admin-sidebar__group-trigger') as HTMLButtonElement).click();
    fixture.detectChanges();
    const links = Array.from(el().querySelectorAll('.admin-sidebar__sublink')).map((a) => a.textContent?.trim());
    expect(links).toEqual(ITINERARIES_ENABLED ? ['Propuestas', 'Itinerarios'] : ['Propuestas']);
  });

  it('con el flag encendido la lista de Itinerarios abre vacía, con sus textos', async () => {
    await mount(ProposalsList, 'itinerary');
    expect(text()).toContain('Itinerarios');
    expect(text()).toContain('Nuevo itinerario');
    expect(text()).toContain('Todavía no hay itinerarios.');
    expect(rows()).toEqual([]);
  });

  it('«Nuevo itinerario» inserta kind = itinerary (contenido sin términos) y el registro aparece SOLO en Itinerarios', async () => {
    const create = (await mount(ProposalCreate, 'itinerary')) as ProposalCreate;
    create.form.setValue({ clientName: 'Ana Pérez', destinationText: 'Chile' });
    await create.save();
    await settle();

    const inserts = db.writes.filter((w) => w.table === 'proposals' && w.op === 'insert');
    expect(inserts).toHaveLength(1);
    expect(inserts[0].payload).toMatchObject({ kind: 'itinerary', client_name: 'Ana Pérez' });
    expect(inserts[0].payload).not.toHaveProperty('currency');
    expect(itineraries()).toHaveLength(1);
    expect(itineraries()[0]['content'].terms).toEqual({ title: '', body: '' });
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', itineraries()[0]['id'], 'edit']);

    await mount(ProposalsList, 'itinerary');
    expect(rows()).toEqual(['Ana Pérez']);
    await mount(ProposalsList, 'proposal');
    expect(rows()).toEqual([]);
    expect(text()).toContain('Todavía no hay propuestas.');
  });

  it('una propuesta existente no aparece en Itinerarios, y los conteos no se mezclan', async () => {
    db.tables['proposals'].push({ id: 'prop-1', kind: 'proposal', client_name: 'Cliente Propuesta', status: 'published', content: {}, updated_at: 'x' });
    db.tables['proposals'].push({ id: 'itin-1', kind: 'itinerary', client_name: 'Cliente Itinerario', status: 'draft', content: {}, updated_at: 'y' });
    const itinerary = (await mount(ProposalsList, 'itinerary')) as ProposalsList;
    expect(rows()).toEqual(['Cliente Itinerario']);
    expect(itinerary.totalCount()).toBe(1);
    const proposal = (await mount(ProposalsList, 'proposal')) as ProposalsList;
    expect(rows()).toEqual(['Cliente Propuesta']);
    expect(proposal.totalCount()).toBe(1);
  });

  describe('editor de un itinerario real', () => {
    const open = (query: Record<string, string> = {}) => mount(ProposalBuilder, 'itinerary', { id: 'itin-1', query });

    beforeEach(() => {
      db.tables['proposals'].push({
        id: 'itin-1', kind: 'itinerary', client_name: 'Ana Pérez', client_email: 'ana@example.com', destination_text: 'Chile', start_date: '2027-03-01',
        end_date: '2027-03-10', travelers_count: 2, status: 'draft', access_required: true, content: { cover: { title: 'Chile', subtitle: '', imagePath: null } },
        updated_at: '2027-01-01T00:00:00Z', title: 'Chile'
      });
    });

    it('pestañas del itinerario y nada comercial', async () => {
      await open();
      expect(tabs()).toEqual(['Datos del viaje', 'Portada', 'Itinerario', 'Travel Tips', 'The Edit Assistant']);
      for (const banned of ['Precios', 'Términos', 'Publicar', 'Despublicar', 'Importar PDF', 'Enviar al cliente', 'Sí, por favor', 'Moneda', 'Aceptación']) {
        expect(text(), banned).not.toContain(banned);
      }
    });

    it('Datos del viaje: cliente, email, destino, fechas, viajeros, acceso privado, código y vencimiento — sin moneda', async () => {
      await open();
      const labels = Array.from(el().querySelectorAll('label')).map((l) => l.textContent?.replace(/\s+/g, ' ').trim().toLowerCase() ?? '');
      const has = (word: string) => labels.some((l) => l.includes(word)) || text().toLowerCase().includes(word);
      for (const word of ['cliente', 'correo', 'destino', 'viajeros', 'acceso privado', 'código de acceso', 'expiración']) {
        expect(has(word), word).toBe(true);
      }
      expect(el().querySelectorAll('input[type="date"]').length).toBe(2);
      expect(el().querySelector('select[formcontrolname="currency"]')).toBeNull();
      expect(text()).not.toMatch(/moneda/i);
    });

    it('editar un dato se guarda en la fila y al recargar se conserva (sin tocar precios ni estado)', async () => {
      await open();
      const name = el().querySelector('input[formcontrolname="clientName"]') as HTMLInputElement;
      name.value = 'Ana María Pérez';
      name.dispatchEvent(new Event('input'));
      name.dispatchEvent(new Event('blur'));
      await settle();
      expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')?.['client_name']).toBe('Ana María Pérez');

      await open(); // recarga: instancia nueva leyendo la «base»
      expect((el().querySelector('input[formcontrolname="clientName"]') as HTMLInputElement).value).toBe('Ana María Pérez');
      const row = db.tables['proposals'].find((r) => r['id'] === 'itin-1')!;
      expect([row['kind'], row['status']]).toEqual(['itinerary', 'draft']);
      const updates = db.writes.filter((w) => w.op === 'update').map((w) => JSON.stringify(w.payload));
      expect(updates.join(' ')).not.toMatch(/status|currency|pricing/);
    });

    it('Portada funciona: el título se guarda y se conserva al recargar', async () => {
      await open({ step: 'cover' });
      expect(text()).toContain('Portada del itinerario');
      const title = el().querySelector('#cover-title') as HTMLInputElement;
      title.value = 'Chile de punta a punta';
      title.dispatchEvent(new Event('input'));
      title.dispatchEvent(new Event('blur'));
      await settle();
      expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')?.['content'].cover.title).toBe('Chile de punta a punta');
      await open({ step: 'cover' });
      expect((el().querySelector('#cover-title') as HTMLInputElement).value).toBe('Chile de punta a punta');
      expect(text()).not.toContain('Términos y condiciones');
    });

    it('Itinerario funciona: agrega día y servicio, y el servicio ofrece documentos', async () => {
      await open({ step: 'journey' });
      (el().querySelector('#journey-add-day') as HTMLButtonElement).click();
      await settle();
      expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')?.['content'].days).toHaveLength(1);
      const hotel = Array.from(el().querySelectorAll('.day-card button')).find((b) => b.textContent?.includes('Hotel')) as HTMLButtonElement;
      hotel.click();
      await settle();
      expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')?.['content'].days[0].services).toHaveLength(1);
      expect(el().querySelector('app-service-documents')).not.toBeNull();
      // Los documentos se consultan (RLS) para ESTE registro; nada de propuestas.
      expect(db.tables['proposal_service_attachments']).toEqual([]);
      await open({ step: 'journey' });
      expect(el().querySelectorAll('.day-card').length).toBe(1);
      expect(el().querySelector('app-service-documents')).not.toBeNull();
    });

    it('Travel Tips funciona: agrega un destino de tips y se conserva al recargar', async () => {
      await open({ step: 'travel-tips' });
      const add = Array.from(el().querySelectorAll('button')).find((b) => b.textContent?.includes('Agregar')) as HTMLButtonElement;
      add.click();
      await settle();
      expect(db.tables['proposals'].find((r) => r['id'] === 'itin-1')?.['content'].travelTips).toHaveLength(1);
      await open({ step: 'travel-tips' });
      expect(el().querySelectorAll('.tip-group').length).toBe(1);
    });

    it('The Edit Assistant abre para el itinerario, sin llamar a nada por sí solo', async () => {
      await open({ step: 'assistant' });
      expect(text()).toContain('The Edit Assistant');
      expect(db.calledFunctions()).toEqual([]);
    });

    it('en todo el recorrido NO se llama send-proposal ni notify-proposal-activity, ni RPC de publicación', async () => {
      for (const step of ['client-trip', 'cover', 'journey', 'travel-tips', 'assistant']) {
        await open({ step });
      }
      const names = db.calledFunctions();
      expect(names).not.toContain('send-proposal');
      expect(names).not.toContain('notify-proposal-activity');
      const rpcs = db.rpcCalls.map((c) => c.name);
      for (const banned of ['publish_proposal', 'unpublish_proposal', 'get_publish_readiness']) {
        expect(rpcs, banned).not.toContain(banned);
      }
    });
  });
  describe('documentos de un itinerario (proposal-service-files)', () => {
    const SERVICE = 'svc-1';
    beforeEach(() => {
      db.tables['proposals'].push({ id: 'itin-1', kind: 'itinerary', client_name: 'Ana Pérez', status: 'draft', content: {}, updated_at: '2027-01-01T00:00:00Z' });
      db.tables['proposal_service_attachments'].push({
        id: 'att-1', proposal_id: 'itin-1', service_id: SERVICE, file_name: 'Entrada.pdf', mime_type: 'application/pdf', file_size: 10,
        visible_to_client: false, created_at: 't', updated_at: 't'
      });
      db.tables['proposal_service_attachments'].push({
        id: 'att-2', proposal_id: 'prop-1', service_id: 'otro', file_name: 'De una propuesta.pdf', mime_type: 'application/pdf', file_size: 10,
        visible_to_client: false, created_at: 't', updated_at: 't'
      });
    });

    async function attachments() {
      await mount(ProposalsList, 'itinerary'); // configura el módulo con la base en memoria
      return TestBed.inject(ProposalServiceAttachmentsService);
    }
    const pdf = () => new File([new Uint8Array(1)], 'Entrada.pdf', { type: 'application/pdf' });

    it('lista SOLO los documentos del itinerario (por proposal_id), sin mezclar los de una propuesta', async () => {
      const service = await attachments();
      expect((await service.listForProposal('itin-1')).map((a) => a.fileName)).toEqual(['Entrada.pdf']);
    });

    it('prepara la subida con el id del itinerario y SIN enviar el tipo (lo decide el servidor)', async () => {
      const service = await attachments();
      db.functionResults['proposal-service-files'] = (body) =>
        body.action === 'prepare-upload'
          ? { data: { storagePath: 'itin-1/svc-1/x.pdf', token: 'tok', contentType: 'application/pdf' }, error: null }
          : { data: { attachment: { id: 'new', proposalId: 'itin-1', serviceId: SERVICE, fileName: 'Entrada.pdf', mimeType: 'application/pdf', fileSize: 1, visibleToClient: false, createdAt: 't', updatedAt: 't' } }, error: null };
      const uploaded = await service.upload('itin-1', SERVICE, pdf());
      expect(uploaded.proposalId).toBe('itin-1');
      const prepare = db.functionCalls.find((c) => (c.body as any).action === 'prepare-upload')!;
      expect(prepare.name).toBe('proposal-service-files');
      expect(prepare.body).toMatchObject({ proposalId: 'itin-1', serviceId: SERVICE });
      expect(prepare.body).not.toHaveProperty('kind');
    });

    it('403 → «No tienes permiso para gestionar estos documentos.»', async () => {
      const service = await attachments();
      db.functionResults['proposal-service-files'] = () => ({ data: null, error: { context: { status: 403, json: async () => ({ code: 'forbidden', error: 'texto técnico' }) } } });
      const err = await service.upload('itin-1', SERVICE, pdf()).catch((e) => e);
      expect([err.message, err.code]).toEqual(['No tienes permiso para gestionar estos documentos.', 'forbidden']);
    });

    it('404 → recurso no disponible, sin revelar propiedad', async () => {
      const service = await attachments();
      db.functionResults['proposal-service-files'] = () => ({ data: null, error: { context: { status: 404, json: async () => ({ code: 'not_found', error: 'No se encontró la propuesta.' }) } } });
      const err = await service.getUrl('att-1').catch((e) => e);
      expect([err.message, err.code]).toEqual(['No se encontró este documento o ya no está disponible.', 'not_found']);
      expect(err.message).not.toMatch(/asesora|propietar|ajen/i);
    });
  });

  describe('regresión de Propuestas con Itinerarios activo', () => {
    const open = (query: Record<string, string> = {}) => mount(ProposalBuilder, 'proposal', { id: 'prop-1', query });

    beforeEach(() => {
      db.tables['proposals'].push({
        id: 'prop-1', kind: 'proposal', client_name: 'Cliente Propuesta', client_email: 'c@example.com', destination_text: 'Perú', status: 'draft', access_required: true,
        currency: 'USD', content: { cover: { title: 'Perú', subtitle: '', imagePath: null } }, updated_at: '2027-01-01T00:00:00Z', title: 'Perú'
      });
    });

    it('crear una propuesta inserta kind = proposal con sus términos de partida', async () => {
      const create = (await mount(ProposalCreate, 'proposal')) as ProposalCreate;
      create.form.setValue({ clientName: 'Nuevo Cliente', destinationText: '' });
      await create.save();
      const insert = db.writes.find((w) => w.op === 'insert')!;
      expect(insert.payload).toMatchObject({ kind: 'proposal', client_name: 'Nuevo Cliente' });
      const created = db.tables['proposals'].find((r) => r['client_name'] === 'Nuevo Cliente')!;
      expect(created['content'].terms.body.length).toBeGreaterThan(0);
      expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', created['id'], 'edit']);
    });

    it('la lista de Propuestas ofrece «Nueva desde PDF», sus cinco estados y no muestra itinerarios', async () => {
      db.tables['proposals'].push({ id: 'itin-1', kind: 'itinerary', client_name: 'Cliente Itinerario', status: 'draft', content: {}, updated_at: '2027-02-01T00:00:00Z' });
      await mount(ProposalsList, 'proposal');
      expect(text()).toContain('Nueva desde PDF');
      expect(text()).toContain('Nueva propuesta');
      expect(rows()).toEqual(['Cliente Propuesta']);
      const chips = Array.from(el().querySelectorAll('.proposals-list__filters button')).map((b) => b.textContent?.replace(/\s+\d+$/, '').trim());
      expect(chips).toEqual(['Todas', 'Borrador', 'Publicada', 'Vista por el cliente', 'Aceptada', 'Expirada']);
    });

    it('el editor de una propuesta conserva Precios, Términos, Moneda, Publicar y el readiness', async () => {
      await open();
      expect(tabs()).toEqual(['Client & Trip', 'Portada', 'Itinerario', 'Precios', 'Travel Tips', 'Términos', 'The Edit Assistant']);
      expect(text()).toContain('Publicar');
      expect(text()).toContain('Moneda');
      expect(db.rpcCalls.map((c) => c.name)).toContain('get_publish_readiness');
    });

    it('Precios y Términos siguen abriendo en una propuesta', async () => {
      await mount(ProposalBuilder, 'proposal', { id: 'prop-1', query: { step: 'terms' } });
      expect(text()).toContain('Términos y condiciones');
      await mount(ProposalBuilder, 'proposal', { id: 'prop-1', query: { step: 'pricing' } });
      expect(text()).toContain('Precios');
    });

    it('la vista previa contractual sigue en la propuesta y no existe en el itinerario', async () => {
      await open();
      expect(el().querySelector('.proposal-builder__preview-col')).not.toBeNull();
      db.tables['proposals'].push({ id: 'itin-9', kind: 'itinerary', client_name: 'I', status: 'draft', content: {}, updated_at: '2027-01-01T00:00:00Z' });
      await mount(ProposalBuilder, 'itinerary', { id: 'itin-9' });
      expect(el().querySelector('.proposal-builder__preview-col')).toBeNull();
    });
  });

});
