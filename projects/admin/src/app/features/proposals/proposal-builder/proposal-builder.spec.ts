import { APP_BASE_HREF, DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, RouterLink, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalBuilder } from './proposal-builder';
import { PublishChecklist } from './publish-checklist/publish-checklist';
import { ProposalsService } from '../../../core/services/proposals';
import { LeadsService } from '../../../core/services/leads';
import { AuthService } from '../../../core/services/auth';
import { PublishProblem } from '../../../core/models/publish-readiness';

const problem = (over: Partial<PublishProblem>): PublishProblem => ({
  position: 1, code: 'cover_title_missing', message: 'Portada: falta el título.', tab: 'cover', day_id: null, service_id: null, line_id: null, ...over
});
const ALL: PublishProblem[] = [
  problem({ position: 1 }),
  problem({ position: 2, code: 'days_missing', message: 'Itinerario: no hay ningún día. Agrega al menos uno.', tab: 'journey' }),
  problem({ position: 3, code: 'price_lines_missing', message: 'Precios: no hay ninguna línea de precio. Agrega al menos una.', tab: 'pricing' }),
  problem({ position: 4, code: 'access_code_missing', message: 'Acceso: falta generar el código de acceso.', tab: 'client-trip' })
];

function proposal(status = 'draft') {
  return {
    id: 'p1', kind: 'proposal', status, clientName: 'Cliente Demo', clientEmail: 'c@ejemplo.test', leadId: null, accessRequired: true, publicToken: 't',
    updatedAt: '2027-01-01T00:00:00Z', acceptedAt: null, acceptedByName: null, content: {}
  };
}

describe('ProposalBuilder — pendientes para publicar', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<ProposalBuilder>;
  let router: Router;

  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const primaryButton = () => el().querySelector('.proposal-builder__actions .btn--primary') as HTMLButtonElement;

  async function create(status = 'draft', readiness: PublishProblem[] | null = ALL): Promise<void> {
    svc['getById'].mockResolvedValue(proposal(status));
    svc['getPublishReadiness'].mockResolvedValue(readiness);
    fixture = TestBed.createComponent(ProposalBuilder);
    fixture.detectChanges();
    await settle();
  }

  beforeEach(async () => {
    svc = {
      getById: vi.fn(),
      getPublishReadiness: vi.fn(),
      publish: vi.fn().mockResolvedValue(undefined),
      sendToClient: vi.fn().mockResolvedValue({ sentTo: 'c@ejemplo.test', sentAt: 'x' })
    };
    await TestBed.configureTestingModule({
      imports: [ProposalBuilder],
      providers: [
        provideRouter([]),
        { provide: APP_BASE_HREF, useValue: '/admin/' },
        { provide: ProposalsService, useValue: svc },
        { provide: LeadsService, useValue: {} },
        { provide: AuthService, useValue: { profile: () => ({ fullName: 'Asesora Demo' }) } },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ id: 'p1' }), queryParamMap: convertToParamMap({}) } } }
      ]
    })
      // Las pestañas hijas (que cargan sus propios datos) se reemplazan: aquí solo importa el constructor.
      .overrideComponent(ProposalBuilder, { set: { imports: [RouterLink, DatePipe, PublishChecklist], schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  it('con pendientes: muestra la lista completa y el botón dice cuántos faltan', async () => {
    await create();
    expect(el().querySelectorAll('.publish-checklist__item').length).toBe(4);
    expect(primaryButton().textContent?.trim()).toBe('Faltan 4 datos para publicar');
    expect(primaryButton().getAttribute('aria-disabled')).toBe('true');
  });

  it('con pendientes, pulsar el botón NO llama a la base ni envía correo: lleva a la lista', async () => {
    await create();
    primaryButton().click();
    await settle();
    expect(svc['publish']).not.toHaveBeenCalled();
    expect(svc['sendToClient']).not.toHaveBeenCalled();
    expect(document.activeElement?.id).toBe('publish-checklist'); // el foco pasa a la lista de pendientes
  });

  it('con pendientes, publicar desde el menú ⋮ tampoco llama a la base', async () => {
    await create();
    (el().querySelector('.proposal-builder__menu-trigger') as HTMLButtonElement).click();
    await settle();
    const item = Array.from(el().querySelectorAll('.proposal-builder__menu-item')).find((b) => b.textContent?.includes('Faltan 4 datos')) as HTMLButtonElement;
    expect(item).toBeTruthy();
    item.click();
    await settle();
    expect(svc['publish']).not.toHaveBeenCalled();
  });

  it('cada punto abre su pestaña', async () => {
    await create();
    const items = Array.from(el().querySelectorAll('.publish-checklist__item')) as HTMLButtonElement[];
    const stepOf = () => (router.navigate as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]?.queryParams?.step;
    items[1].click();
    expect(stepOf()).toBe('journey');
    items[2].click();
    expect(stepOf()).toBe('pricing');
    items[3].click();
    expect(stepOf()).toBe('client-trip');
    items[0].click();
    expect(stepOf()).toBe('cover');
  });

  it('se actualiza al guardar: la lista y el botón reflejan lo que ya se completó', async () => {
    await create();
    expect(svc['getPublishReadiness']).toHaveBeenCalledTimes(1);
    svc['getPublishReadiness'].mockResolvedValue([ALL[3]]);
    await fixture.componentInstance.onSaved();
    await settle();
    expect(svc['getPublishReadiness']).toHaveBeenCalledTimes(2);
    expect(el().querySelectorAll('.publish-checklist__item').length).toBe(1);
    expect(primaryButton().textContent?.trim()).toBe('Falta 1 dato para publicar');
  });

  it('al generar el código de acceso también se recalcula (no emite «guardado»)', async () => {
    await create();
    svc['getPublishReadiness'].mockResolvedValue([]);
    fixture.componentInstance.onCodeGenerated('ABCD-1234');
    await settle();
    expect(el().querySelector('#publish-checklist')).toBeNull();
    expect(primaryButton().textContent?.trim()).toBe('Publicar y enviar al cliente');
  });

  it('sin pendientes: el botón publica y envía como siempre', async () => {
    await create('draft', []);
    expect(el().querySelector('#publish-checklist')).toBeNull();
    primaryButton().click();
    await settle();
    expect(svc['publish']).toHaveBeenCalledWith('p1');
    expect(svc['sendToClient']).toHaveBeenCalled();
  });

  it('si no se pudo saber qué falta (null, p. ej. migración sin aplicar) no se bloquea: decide la base', async () => {
    await create('draft', null);
    expect(el().querySelector('#publish-checklist')).toBeNull();
    primaryButton().click();
    await settle();
    expect(svc['publish']).toHaveBeenCalledWith('p1');
  });

  it('una propuesta ya publicada no muestra la lista ni consulta los pendientes', async () => {
    await create('published', ALL);
    expect(el().querySelector('#publish-checklist')).toBeNull();
    expect(svc['getPublishReadiness']).not.toHaveBeenCalled();
    expect(text()).not.toContain('Faltan');
  });

  it('si el pendiente trae un día, servicio o línea concreta, se navega a esa pestaña igual', async () => {
    await create('draft', [problem({ code: 'x', tab: 'pricing', line_id: 'l9', message: 'Precios: la línea «Hotel» no tiene precio.' })]);
    (el().querySelector('.publish-checklist__item') as HTMLButtonElement).click();
    expect((router.navigate as ReturnType<typeof vi.fn>).mock.calls.at(-1)?.[1]?.queryParams?.step).toBe('pricing');
  });

  it('«Abrir en nueva pestaña» respeta el prefijo /admin/ (sin él la pestaña caía en la página principal de la web)', async () => {
    await create();
    vi.spyOn(router, 'createUrlTree').mockReturnValue({} as never);
    vi.spyOn(router, 'serializeUrl').mockReturnValue('/proposals/p1/edit?step=preview');
    const openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
    fixture.componentInstance.openPreviewInNewTab();
    expect(openSpy).toHaveBeenCalledWith('/admin/proposals/p1/edit?step=preview', '_blank', 'noopener');
  });
});
