import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ProposalsService } from './proposals';
import { ProposalServiceAttachmentsService } from './proposal-service-attachments';
import { SupabaseService } from './supabase';
import { AuthService } from './auth';
import { ROLE_PERMISSION_CODES, can } from '../data/permissions';
import { TRAVEL_CONFIG } from '../../features/travel/travel-config';
import { pendingLabel } from '../models/publish-readiness';

describe('ProposalsService — compartir itinerarios (0056)', () => {
  let rpc: ReturnType<typeof vi.fn>;
  let invoke: ReturnType<typeof vi.fn>;
  let service: ProposalsService;

  beforeEach(() => {
    rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    invoke = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        { provide: SupabaseService, useValue: { client: { rpc, functions: { invoke } } } },
        { provide: AuthService, useValue: { profile: () => ({ id: 'u1' }) } },
        { provide: ProposalServiceAttachmentsService, useValue: {} }
      ]
    });
    service = TestBed.inject(ProposalsService);
  });

  it('shareItinerary / unshareItinerary llaman a SUS RPC (nunca publish_proposal ni unpublish_proposal)', async () => {
    await service.shareItinerary('i1');
    await service.unshareItinerary('i1');
    expect(rpc.mock.calls).toEqual([['share_itinerary', { p_id: 'i1' }], ['unshare_itinerary', { p_id: 'i1' }]]);
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain('publish_proposal');
    expect(rpc.mock.calls.map((c) => c[0])).not.toContain('unpublish_proposal');
  });

  it('los errores de la base se relanzan tal cual (el texto exacto llega a la interfaz)', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'Faltan datos para compartir: falta el destino' } });
    await expect(service.shareItinerary('i1')).rejects.toMatchObject({ message: 'Faltan datos para compartir: falta el destino' });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'No autorizado' } });
    await expect(service.unshareItinerary('i1')).rejects.toMatchObject({ message: 'No autorizado' });
  });

  it('getItineraryShareReadiness pide la lista con para_correo y la ordena por posición; null si no se pudo saber', async () => {
    rpc.mockResolvedValueOnce({
      data: [
        { position: 2, code: 'days_missing', message: 'b', tab: 'journey', day_id: null, service_id: null, line_id: null },
        { position: 1, code: 'destination_missing', message: 'a', tab: 'client-trip', day_id: null, service_id: null, line_id: null }
      ],
      error: null
    });
    const problems = await service.getItineraryShareReadiness('i1', true);
    expect(rpc).toHaveBeenCalledWith('get_itinerary_share_readiness', { p_id: 'i1', p_for_email: true });
    expect(problems?.map((p) => p.code)).toEqual(['destination_missing', 'days_missing']);
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    expect(await service.getItineraryShareReadiness('i1')).toBeNull();
    expect(rpc).toHaveBeenLastCalledWith('get_itinerary_share_readiness', { p_id: 'i1', p_for_email: false });
  });

  it('sendItineraryToClient invoca send-itinerary solo con el id (nunca destinatario ni texto) y devuelve el resultado', async () => {
    invoke.mockResolvedValue({ data: { ok: true, sentTo: 'ana@example.com', sentAt: 't' }, error: null });
    expect(await service.sendItineraryToClient('i1')).toEqual({ sentTo: 'ana@example.com', sentAt: 't' });
    expect(invoke).toHaveBeenCalledWith('send-itinerary', { body: { itineraryId: 'i1' } });
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain('send-proposal');
  });

  it('send-itinerary: los mensajes del servidor (primero compartir, falta el correo, vencido) llegan en español', async () => {
    const httpError = (body: unknown) => ({ data: null, error: { context: { status: 400, json: async () => body } } });
    invoke.mockResolvedValueOnce(httpError({ code: 'INVALID_STATUS', error: 'Primero comparte el itinerario: solo se puede enviar uno compartido.' }));
    await expect(service.sendItineraryToClient('i1')).rejects.toThrow('Primero comparte el itinerario');
    invoke.mockResolvedValueOnce(httpError({ code: 'NO_RECIPIENT', error: 'Falta un correo válido del cliente. Agrégalo en «Datos del viaje».' }));
    await expect(service.sendItineraryToClient('i1')).rejects.toThrow('Falta un correo válido del cliente');
    invoke.mockResolvedValueOnce(httpError({ code: 'KIND_NOT_SUPPORTED', error: 'texto técnico' }));
    await expect(service.sendItineraryToClient('i1')).rejects.toThrow('Este envío es solo para itinerarios.');
    invoke.mockResolvedValueOnce({ data: null, error: new Error('red') });
    await expect(service.sendItineraryToClient('i1')).rejects.toThrow('No se pudo enviar el itinerario. Inténtalo nuevamente.');
    invoke.mockResolvedValueOnce({ data: { ok: false }, error: null });
    await expect(service.sendItineraryToClient('i1')).rejects.toThrow('No se pudo enviar el itinerario');
  });

  it('send-proposal sigue siendo de propuestas: sendToClient manda mode=proposal y no toca send-itinerary', async () => {
    invoke.mockResolvedValue({ data: { ok: true, sentTo: 'a@b.co', sentAt: 't' }, error: null });
    await service.sendToClient('p1');
    expect(invoke).toHaveBeenCalledWith('send-proposal', { body: { mode: 'proposal', proposalId: 'p1' } });
  });

  it('la etiqueta de pendientes habla de «compartir» en un itinerario y de «publicar» en una propuesta', () => {
    expect(pendingLabel(1)).toBe('Falta 1 dato para publicar');
    expect(pendingLabel(3)).toBe('Faltan 3 datos para publicar');
    expect(pendingLabel(1, 'compartir')).toBe('Falta 1 dato para compartir');
    expect(pendingLabel(2, 'compartir')).toBe('Faltan 2 datos para compartir');
  });

  it('permisos: itinerarios.compartir lo tienen admin, editor y staff (como can_travel); no se confunde con propuestas.publicar', () => {
    for (const role of ['admin', 'editor', 'staff'] as const) {
      expect(can(role, 'itinerarios.compartir'), role).toBe(true);
      expect(ROLE_PERMISSION_CODES[role]).toContain('itinerarios.compartir');
    }
    expect(can(undefined, 'itinerarios.compartir')).toBe(false);
    expect(TRAVEL_CONFIG.itinerary.permissions.share).toBe('itinerarios.compartir');
    expect(TRAVEL_CONFIG.proposal.permissions.share).toBe('propuestas.publicar');
    // Eliminar sigue siendo solo del admin.
    expect(can('editor', 'itinerarios.eliminar')).toBe(false);
    expect(can('admin', 'itinerarios.eliminar')).toBe(true);
  });
});
