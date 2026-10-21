import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import {
  ATTACHMENTS_FORBIDDEN_MESSAGE,
  ATTACHMENTS_NOT_FOUND_MESSAGE,
  ProposalServiceAttachmentsService
} from './proposal-service-attachments';
import { SupabaseService } from './supabase';
import { AttachmentApiError } from '../models/proposal-service-attachment.model';

const PROPOSAL = '11111111-1111-4111-8111-111111111111';
const ITINERARY = '22222222-2222-4222-8222-222222222222';
const SERVICE = '33333333-3333-4333-8333-333333333333';
const PATH = `${ITINERARY}/${SERVICE}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.pdf`;

const pdf = () => new File([new Uint8Array(1)], 'Entrada.pdf', { type: 'application/pdf' });
const view = (proposalId: string) => ({
  id: 'att-1', proposalId, serviceId: SERVICE, fileName: 'Entrada.pdf', mimeType: 'application/pdf', fileSize: 1, visibleToClient: false, createdAt: 't', updatedAt: 't'
});
/** Lo que supabase-js entrega cuando la Edge Function responde un error HTTP. */
const httpError = (status: number, body: unknown) => ({ data: null, error: { context: { status, json: async () => body } } });

describe('ProposalServiceAttachmentsService — documentos de Propuesta e Itinerario', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let service: ProposalServiceAttachmentsService;

  beforeEach(() => {
    invoke = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: SupabaseService,
          useValue: { client: { functions: { invoke }, storage: { from: () => ({ uploadToSignedUrl: async () => ({ data: {}, error: null }) }) } } }
        }
      ]
    });
    service = TestBed.inject(ProposalServiceAttachmentsService);
  });

  it('itinerario: sube, firma, cambia visibilidad y borra con el MISMO flujo que una propuesta', async () => {
    invoke.mockImplementation(async (_n: string, opts: { body: Record<string, unknown> }) => {
      switch (opts.body['action']) {
        case 'prepare-upload':
          return { data: { storagePath: PATH, token: 'tok', contentType: 'application/pdf' }, error: null };
        case 'finalize-upload':
          return { data: { attachment: view(ITINERARY) }, error: null };
        case 'sign':
          return { data: { url: 'https://storage.test/x' }, error: null };
        case 'set-visibility':
          return { data: { attachment: { ...view(ITINERARY), visibleToClient: true } }, error: null };
        default:
          return { data: { deleted: true }, error: null };
      }
    });
    const uploaded = await service.upload(ITINERARY, SERVICE, pdf());
    expect(uploaded.proposalId).toBe(ITINERARY);
    expect(await service.getUrl('att-1')).toBe('https://storage.test/x');
    expect((await service.setVisibility('att-1', true)).visibleToClient).toBe(true);
    await service.delete('att-1');
    expect(invoke.mock.calls.map((c) => c[1].body.action)).toEqual(['prepare-upload', 'finalize-upload', 'sign', 'set-visibility', 'delete']);
    // El tipo NO viaja en la solicitud: lo decide el servidor leyendo la fila.
    for (const [, opts] of invoke.mock.calls) {
      expect(opts.body).not.toHaveProperty('kind');
    }
  });

  it('quitar un servicio de un itinerario devuelve su contenido SIN términos de partida; una propuesta conserva lo suyo', async () => {
    invoke.mockResolvedValue({ data: { content: {}, deletedDocuments: 0 }, error: null });
    const itinerary = await service.removeService(ITINERARY, 'd1', SERVICE, undefined, 'itinerary');
    expect(itinerary.content.terms).toEqual({ title: '', body: '' });
    const proposal = await service.removeService(PROPOSAL, 'd1', SERVICE);
    expect(proposal.content.terms.title).not.toBe('');
    const day = await service.removeDay(ITINERARY, 'd1', undefined, 'itinerary');
    expect(day.content.terms.body).toBe('');
  });

  it('403 → «No tienes permiso para gestionar estos documentos.» (mensaje fijo, aunque el servidor diga otra cosa)', async () => {
    invoke.mockResolvedValue(httpError(403, { error: 'No tienes permiso para gestionar los documentos de este viaje.', code: 'forbidden' }));
    const err = await service.upload(ITINERARY, SERVICE, pdf()).catch((e) => e);
    expect(err).toBeInstanceOf(AttachmentApiError);
    expect([err.message, err.code]).toEqual(['No tienes permiso para gestionar estos documentos.', 'forbidden']);
    expect(ATTACHMENTS_FORBIDDEN_MESSAGE).toBe('No tienes permiso para gestionar estos documentos.');
  });

  it('403 sin cuerpo legible igual da el mensaje de permiso', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { status: 403, json: async () => { throw new Error('no json'); } } } });
    const err = await service.setVisibility('att-1', true).catch((e) => e);
    expect(err.message).toBe(ATTACHMENTS_FORBIDDEN_MESSAGE);
  });

  it('404 genérico → recurso no disponible, sin revelar de quién es ni «a otra asesora»', async () => {
    invoke.mockResolvedValue(httpError(404, { error: 'No se encontró la propuesta.', code: 'not_found' }));
    const err = await service.getUrl('att-1').catch((e) => e);
    expect([err.message, err.code]).toEqual([ATTACHMENTS_NOT_FOUND_MESSAGE, 'not_found']);
    expect(err.message).not.toMatch(/asesora|propietar|ajen|propuesta/i);
  });

  it('un 403 y un 404 no se confunden: son mensajes distintos', () => {
    expect(ATTACHMENTS_FORBIDDEN_MESSAGE).not.toBe(ATTACHMENTS_NOT_FOUND_MESSAGE);
  });

  it('los 404 específicos conservan su texto (servicio inexistente, archivo no subido)', async () => {
    invoke.mockResolvedValue(httpError(404, { error: 'Ese servicio no pertenece a esta propuesta.', code: 'service_not_found' }));
    const err = await service.upload(ITINERARY, SERVICE, pdf()).catch((e) => e);
    expect([err.message, err.code]).toEqual(['Ese servicio no pertenece a esta propuesta.', 'service_not_found']);
  });

  it('otros errores del servidor siguen igual (confirmation_required con su recuento)', async () => {
    invoke.mockResolvedValue(httpError(409, { error: 'Hay documentos adjuntos.', code: 'confirmation_required', attachmentCount: 3 }));
    const err = await service.removeService(ITINERARY, 'd1', SERVICE, undefined, 'itinerary').catch((e) => e);
    expect([err.code, err.attachmentCount]).toEqual(['confirmation_required', 3]);
  });

  it('sin respuesta HTTP (red) → mensaje de conexión, sin texto técnico', async () => {
    invoke.mockResolvedValue({ data: null, error: new Error('Failed to fetch') });
    const err = await service.getUrl('att-1').catch((e) => e);
    expect(err.code).toBe('network');
    expect(err.message).not.toContain('Failed to fetch');
  });
});
