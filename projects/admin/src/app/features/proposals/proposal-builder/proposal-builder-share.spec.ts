import { APP_BASE_HREF, DatePipe } from '@angular/common';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, RouterLink, convertToParamMap, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalBuilder } from './proposal-builder';
import { ClientTripStep } from './client-trip-step/client-trip-step';
import { PublishChecklist } from './publish-checklist/publish-checklist';
import { ConfirmDialog } from '../../../shared/ui/confirm-dialog/confirm-dialog';
import { AdminModal } from '../../../shared/ui/admin-modal/admin-modal';
import { AuthService } from '../../../core/services/auth';
import { LeadsService } from '../../../core/services/leads';
import { ProposalImagesService } from '../../../core/services/proposal-images';
import { ProposalsService } from '../../../core/services/proposals';
import { PublishProblem } from '../../../core/models/publish-readiness';
import { environment } from '../../../../environments/environment';
import { TravelMode } from '../../travel/travel-config';

const content = {
  cover: { title: 'T', subtitle: 'S', imagePath: null }, welcome: { body: '' }, intro: { headline: '', body: '' }, terms: { title: '', body: '' },
  days: [], pricing: { lines: [], feesLines: [] }, travelTips: []
};
const row = (kind: TravelMode, status: string, over: Record<string, unknown> = {}) => ({
  id: 'p1', kind, status, clientName: 'Ana Pérez', clientEmail: 'ana@example.com', leadId: null, destinationText: 'Chile', startDate: null, endDate: null,
  travelersCount: 2, currency: 'USD', accessRequired: false, expiresAt: null, publicToken: 'tok-123', updatedAt: '2027-01-01T00:00:00Z',
  sharedAt: status === 'shared' || status === 'viewed' ? '2027-01-02T10:00:00Z' : null, acceptedAt: null, acceptedByName: null, content, ...over
});
const problem = (code: string, message: string): PublishProblem => ({ position: 1, code, message, tab: 'client-trip', day_id: null, service_id: null, line_id: null });

describe('ProposalBuilder — compartir un itinerario (y la barra de propuestas intacta)', () => {
  let svc: Record<string, ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<ProposalBuilder>;
  let writeText: ReturnType<typeof vi.fn>;
  let open: ReturnType<typeof vi.spyOn>;
  const el = () => fixture.nativeElement as HTMLElement;
  const text = () => el().textContent?.replace(/\s+/g, ' ') ?? '';
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const button = (label: string) => Array.from(el().querySelectorAll('.proposal-builder__actions button, .proposal-builder__menu-panel button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const headerButtons = () => Array.from(el().querySelectorAll('.proposal-builder__actions > button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim());
  async function openMenu(): Promise<string[]> {
    (el().querySelector('.proposal-builder__menu-trigger') as HTMLButtonElement).click();
    await settle();
    return Array.from(el().querySelectorAll('.proposal-builder__menu-panel button')).map((b) => b.textContent?.replace(/\s+/g, ' ').trim() ?? '');
  }

  async function render(kind: TravelMode, status: string, opts: { role?: string; row?: Record<string, unknown>; problems?: PublishProblem[] | null } = {}): Promise<void> {
    TestBed.resetTestingModule();
    writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    open = vi.spyOn(window, 'open').mockReturnValue(null);
    svc = {
      getById: vi.fn().mockResolvedValue(row(kind, status, opts.row)),
      getPublishReadiness: vi.fn().mockResolvedValue([]),
      getItineraryShareReadiness: vi.fn().mockResolvedValue(opts.problems ?? []),
      hasAccessCode: vi.fn().mockResolvedValue(true),
      shareItinerary: vi.fn().mockResolvedValue(undefined),
      unshareItinerary: vi.fn().mockResolvedValue(undefined),
      sendItineraryToClient: vi.fn().mockResolvedValue({ sentTo: 'ana@example.com', sentAt: 't' }),
      sendToClient: vi.fn().mockResolvedValue({ sentTo: 'ana@example.com', sentAt: 't' }),
      publish: vi.fn().mockResolvedValue(undefined),
      unpublish: vi.fn().mockResolvedValue(undefined)
    };
    await TestBed.configureTestingModule({
      imports: [ProposalBuilder],
      providers: [
        provideRouter([]),
        { provide: APP_BASE_HREF, useValue: '/admin/' },
        { provide: ProposalsService, useValue: svc },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(null) } },
        { provide: AuthService, useValue: { profile: () => ({ fullName: 'Asesora Demo', role: opts.role ?? 'staff' }) } },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { data: { mode: kind }, paramMap: convertToParamMap({ id: 'p1' }), queryParamMap: convertToParamMap({}) } }
        }
      ]
    })
      .overrideComponent(ProposalBuilder, { set: { imports: [RouterLink, DatePipe, PublishChecklist, ClientTripStep, ConfirmDialog, AdminModal], schemas: [NO_ERRORS_SCHEMA] } })
      .compileComponents();
    fixture = TestBed.createComponent(ProposalBuilder);
    fixture.detectChanges();
    await settle();
  }

  afterEach(() => {
    fixture?.destroy();
    vi.restoreAllMocks();
  });

  const publicLink = () => `${environment.publicSiteUrl || window.location.origin}/private/tok-123`;

  // ---------------------------------------------------------------- borrador
  it('itinerario en borrador: ofrece «Compartir itinerario» y NADA de distribución (ni enlace, ni WhatsApp, ni correo)', async () => {
    await render('itinerary', 'draft');
    expect(headerButtons()).toContain('Compartir itinerario');
    // Se revisan los BOTONES de acción (el modal de WhatsApp existe en el DOM, cerrado, y tiene su propio título).
    for (const banned of ['Copiar enlace', 'WhatsApp', 'Enviar al cliente', 'Dejar de compartir', 'Publicar', 'Despublicar']) {
      expect(headerButtons().join('|'), banned).not.toContain(banned);
    }
    const menu = await openMenu();
    expect(menu).toContain('Compartir itinerario');
    expect(menu.join('|')).not.toMatch(/Copiar enlace|WhatsApp|Enviar al cliente|Dejar de compartir/);
    // El token existe, pero en borrador NO hay enlace utilizable.
    expect(fixture.componentInstance.privateLink()).toBeNull();
    expect(text()).toContain('Comparte el itinerario para habilitar el enlace, WhatsApp y el envío por correo.');
  });

  it('itinerario en borrador: usa la lista de pendientes de COMPARTIR (no la de publicar)', async () => {
    await render('itinerary', 'draft');
    expect(svc['getItineraryShareReadiness']).toHaveBeenCalledWith('p1');
    expect(svc['getPublishReadiness']).not.toHaveBeenCalled();
  });

  it('con pendientes: la lista dice «para compartir», el botón muestra cuántos faltan y NO llama a la base', async () => {
    await render('itinerary', 'draft', { problems: [problem('destination_missing', 'Datos del viaje: falta el destino.'), problem('days_missing', 'Itinerario: agrega al menos un día.')] });
    expect(text()).toContain('Faltan 2 datos para compartir');
    expect(text()).toContain('Datos del viaje: falta el destino.');
    expect(headerButtons().some((b) => b?.includes('Faltan 2 datos para compartir'))).toBe(true);
    (el().querySelector('.proposal-builder__actions .btn--primary') as HTMLButtonElement).click();
    await settle();
    expect(svc['shareItinerary']).not.toHaveBeenCalled();
  });

  it('«Compartir itinerario» llama a share_itinerary (no a publish) y vuelve a leer el registro', async () => {
    await render('itinerary', 'draft');
    const reads = svc['getById'].mock.calls.length;
    button('Compartir itinerario')!.click();
    await settle();
    expect(svc['shareItinerary']).toHaveBeenCalledWith('p1');
    expect(svc['publish']).not.toHaveBeenCalled();
    expect(svc['getById'].mock.calls.length).toBeGreaterThan(reads);
  });

  it('si compartir falla por pendientes, muestra el motivo del servidor; un error desconocido, un mensaje genérico', async () => {
    await render('itinerary', 'draft');
    svc['shareItinerary'].mockRejectedValueOnce({ message: 'Faltan datos para compartir: Datos del viaje: falta el destino.' });
    button('Compartir itinerario')!.click();
    await settle();
    expect(text()).toContain('Faltan datos para compartir: Datos del viaje: falta el destino.');
    svc['shareItinerary'].mockRejectedValueOnce({ message: 'relation "x" does not exist' });
    button('Compartir itinerario')!.click();
    await settle();
    expect(text()).toContain('No se pudo compartir el itinerario. Inténtalo nuevamente.');
    expect(text()).not.toContain('relation');
  });

  // ---------------------------------------------------------------- compartido / visto
  it.each([
    ['shared', 'Compartido'],
    ['viewed', 'Visto por el cliente']
  ])('itinerario %s: ofrece Enviar al cliente, WhatsApp y Copiar enlace; estado «%s»; sin «Compartir itinerario»', async (status, label) => {
    await render('itinerary', status);
    const buttons = headerButtons();
    expect(buttons).toEqual(expect.arrayContaining(['Enviar al cliente', 'WhatsApp', 'Copiar enlace']));
    expect(buttons).not.toContain('Compartir itinerario');
    expect(el().querySelector('.proposal-builder__status-badge')?.textContent?.trim()).toBe(label);
    expect(text()).toContain('Itinerario compartido el');
    expect(text()).toContain('El enlace ya está activo para el cliente');
    expect(svc['getItineraryShareReadiness']).not.toHaveBeenCalled(); // la lista de pendientes solo existe en borrador
  });

  it('el menú ofrece además «Dejar de compartir» (solo compartido/visto)', async () => {
    await render('itinerary', 'shared');
    const menu = await openMenu();
    expect(menu).toEqual(expect.arrayContaining(['Copiar enlace privado', 'Enviar al cliente', 'Enviar por WhatsApp', 'Dejar de compartir']));
    expect(menu).not.toContain('Compartir itinerario');
  });

  it('Copiar enlace copia la URL privada OFICIAL (/private/<public_token>), sin inventar otra', async () => {
    await render('itinerary', 'shared');
    expect(fixture.componentInstance.privateLink()).toBe(publicLink());
    button('Copiar enlace')!.click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(publicLink());
    expect(publicLink()).toMatch(/^https?:\/\/.+\/private\/tok-123$/);
    expect(button('Enlace copiado ✓')).toBeDefined();
  });

  it('WhatsApp: abre el modal con un mensaje de ITINERARIO que lleva la URL privada y el destino, y SIN lenguaje de propuesta', async () => {
    await render('itinerary', 'shared');
    button('WhatsApp')!.click();
    await settle();
    const message = fixture.componentInstance.whatsappMessage();
    expect(message).toContain(publicLink());
    expect(message).toContain('Hola Ana, soy Asesora Demo de The Travel Edit. Te compartimos el itinerario de tu viaje a Chile:');
    expect(message.toLowerCase()).not.toContain('propuesta');
    expect(message.toLowerCase()).not.toContain('precio');
    expect(fixture.componentInstance.whatsappUrl()).toBe(`https://wa.me/?text=${encodeURIComponent(message)}`);
  });

  it('WhatsApp sin teléfono abre la composición sin número fijo; con teléfono usa solo sus dígitos; no registra ningún envío', async () => {
    await render('itinerary', 'shared');
    button('WhatsApp')!.click();
    await settle();
    fixture.componentInstance.sendWhatsapp();
    expect(open).toHaveBeenCalledTimes(1);
    expect(String(open.mock.calls[0][0])).toMatch(/^https:\/\/wa\.me\/\?text=/);
    expect(open.mock.calls[0][2]).toBe('noopener');
    fixture.componentInstance.whatsappPhone.set('+504 9999-8888');
    fixture.componentInstance.sendWhatsapp();
    expect(String(open.mock.calls[1][0])).toMatch(/^https:\/\/wa\.me\/50499998888\?text=/);
    // Abrir WhatsApp NO es un envío confirmado: no se llama a ninguna Edge Function ni RPC de envío.
    for (const name of ['sendItineraryToClient', 'sendToClient', 'shareItinerary', 'unshareItinerary', 'publish']) {
      expect(svc[name], name).not.toHaveBeenCalled();
    }
  });

  it('WhatsApp con acceso protegido pide el código (nunca sale de este navegador) y el mensaje lo incluye solo si se escribe', async () => {
    await render('itinerary', 'shared', { row: { accessRequired: true } });
    button('WhatsApp')!.click();
    await settle();
    expect(fixture.componentInstance.whatsappReady()).toBe(false);
    expect(fixture.componentInstance.whatsappMessage()).toContain('Tu código de acceso: (escríbelo aquí)');
    fixture.componentInstance.whatsappCode.set('TRV-ABC12');
    expect(fixture.componentInstance.whatsappReady()).toBe(true);
    expect(fixture.componentInstance.whatsappMessage()).toContain('Tu código de acceso: TRV-ABC12');
  });

  it('Enviar al cliente usa el flujo de ITINERARIO (send-itinerary), nunca el de propuestas, y confirma «Itinerario enviado a»', async () => {
    await render('itinerary', 'shared');
    button('Enviar al cliente')!.click();
    await settle();
    expect(svc['sendItineraryToClient']).toHaveBeenCalledWith('p1');
    expect(svc['sendToClient']).not.toHaveBeenCalled();
    expect(text()).toContain('✓ Itinerario enviado a ana@example.com');
    expect(text()).not.toContain('Propuesta enviada');
  });

  it('si el envío falla muestra el mensaje y permite reintentar', async () => {
    await render('itinerary', 'shared');
    svc['sendItineraryToClient'].mockRejectedValueOnce(new Error('Falta un correo válido del cliente. Agrégalo en «Datos del viaje».'));
    button('Enviar al cliente')!.click();
    await settle();
    expect(text()).toContain('Falta un correo válido del cliente');
    expect(text()).toContain('Reintentar envío');
  });

  it('Dejar de compartir pide confirmación; cancelar no hace nada; confirmar llama a unshare_itinerary y recarga', async () => {
    await render('itinerary', 'shared');
    await openMenu();
    button('Dejar de compartir')!.click();
    await settle();
    expect(fixture.componentInstance.unsharePending()).toBe(true);
    expect(text()).toContain('El enlace dejará de funcionar');
    fixture.componentInstance.cancelUnshare();
    expect(svc['unshareItinerary']).not.toHaveBeenCalled();
    const reads = svc['getById'].mock.calls.length;
    await fixture.componentInstance.confirmUnshare();
    await settle();
    expect(svc['unshareItinerary']).toHaveBeenCalledWith('p1');
    expect(svc['unpublish']).not.toHaveBeenCalled();
    expect(svc['getById'].mock.calls.length).toBeGreaterThan(reads);
  });

  // ---------------------------------------------------------------- permisos
  it.each(['admin', 'editor', 'staff'])('%s puede compartir itinerarios', async (role) => {
    await render('itinerary', 'draft', { role });
    expect(headerButtons()).toContain('Compartir itinerario');
  });

  // ---------------------------------------------------------------- propuesta: intacta
  it('PROPUESTA en borrador (regresión): «Publicar y enviar al cliente»; nada de compartir', async () => {
    await render('proposal', 'draft');
    expect(headerButtons().some((b) => b?.includes('Publicar y enviar al cliente'))).toBe(true);
    expect(text()).not.toContain('Compartir itinerario');
    expect(svc['getPublishReadiness']).toHaveBeenCalled();
    expect(svc['getItineraryShareReadiness']).not.toHaveBeenCalled();
  });

  it('PROPUESTA publicada (regresión): «Enviar al cliente» y «Enviar por WhatsApp»; send-proposal, no send-itinerary', async () => {
    await render('proposal', 'published');
    expect(headerButtons()).toEqual(expect.arrayContaining(['Enviar al cliente', 'Enviar por WhatsApp']));
    expect(headerButtons()).not.toContain('Copiar enlace');
    expect(text()).not.toContain('Dejar de compartir');
    button('Enviar al cliente')!.click();
    await settle();
    expect(svc['sendToClient']).toHaveBeenCalledWith('p1');
    expect(svc['sendItineraryToClient']).not.toHaveBeenCalled();
    expect(text()).toContain('✓ Propuesta enviada a ana@example.com');
  });

  it('PROPUESTA (regresión): el mensaje de WhatsApp es el de propuesta, con su enlace', async () => {
    await render('proposal', 'published');
    button('Enviar por WhatsApp')!.click();
    await settle();
    const message = fixture.componentInstance.whatsappMessage();
    expect(message).toContain('Tu propuesta de viaje está lista');
    expect(message).toContain(publicLink());
    expect(message).not.toContain('itinerario');
  });

  it('PROPUESTA (regresión): el menú conserva Copiar enlace privado, Despublicar y el resto', async () => {
    await render('proposal', 'published');
    const menu = await openMenu();
    expect(menu).toEqual(expect.arrayContaining(['Copiar enlace privado', 'Despublicar', 'Enviar al cliente', 'Enviar por WhatsApp']));
    expect(menu).not.toContain('Dejar de compartir');
  });

  it('PROPUESTA: el enlace privado se sigue ofreciendo según su estado de siempre (publicada sí)', async () => {
    await render('proposal', 'published');
    expect(fixture.componentInstance.privateLink()).toBe(publicLink());
  });
});
