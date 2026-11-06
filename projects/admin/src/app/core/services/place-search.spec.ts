import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PlaceSearchService, candidatePlace, formatWait, placeSearchMessage, suggestionPauseMessage } from './place-search';
import { SupabaseService } from './supabase';

const GOOD = { provider: 'osm', osmType: 'way', osmId: 1, name: 'Torre', address: 'Lisboa', lat: 38.69, lon: -9.21, bbox: [38.68, -9.22, 38.7, -9.2] };

describe('PlaceSearchService', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let service: PlaceSearchService;

  beforeEach(() => {
    invoke = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client: { functions: { invoke } } } }] });
    service = TestBed.inject(PlaceSearchService);
  });

  it('llama solo a la Edge Function geocode-place con la consulta', async () => {
    invoke.mockResolvedValue({ data: { success: true, results: [GOOD], cached: true }, error: null });
    const response = await service.search('torre de belém');
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith('geocode-place', { body: { query: 'torre de belém' } });
    expect(response.results).toEqual([GOOD]);
  });

  it('vuelve a validar: descarta candidatos con coordenadas inválidas y recorta a 3', async () => {
    const many = [GOOD, { ...GOOD, lat: 95 }, { ...GOOD, provider: 'x' }, { ...GOOD, osmId: 2 }, { ...GOOD, osmId: 3 }, { ...GOOD, osmId: 4 }];
    invoke.mockResolvedValue({ data: { success: true, results: many }, error: null });
    const response = await service.search('x y z');
    expect(response.results?.map((r) => r.osmId)).toEqual([1, 2, 3]);
  });

  it('errores de la función: conserva el código y el tiempo de espera; sin cuerpo → network_failure', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ success: false, error: 'busy', retryAfterSeconds: 7 }) } } });
    expect(await service.search('x y z')).toEqual({ success: false, error: 'busy', retryAfterSeconds: 7 });
    invoke.mockResolvedValueOnce({ data: null, error: new Error('red') });
    expect(await service.search('x y z')).toEqual({ success: false, error: 'network_failure' });
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => { throw new Error('no json'); } } } });
    expect((await service.search('x y z')).error).toBe('network_failure');
  });

  it('respuesta inesperada → unexpected_error', async () => {
    invoke.mockResolvedValueOnce({ data: { success: true }, error: null });
    expect((await service.search('x y z')).error).toBe('unexpected_error');
    invoke.mockResolvedValueOnce({ data: null, error: null });
    expect((await service.search('x y z')).error).toBe('unexpected_error');
  });
});

describe('PlaceSearchService.suggest', () => {
  let invoke: ReturnType<typeof vi.fn>;
  let service: PlaceSearchService;
  beforeEach(() => {
    invoke = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client: { functions: { invoke } } } }] });
    service = TestBed.inject(PlaceSearchService);
  });

  it('pide mode «autocomplete» a la misma función, con la preferencia solo si son coordenadas finitas, y recorta a 5', async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ ...GOOD, osmId: i + 1 }));
    invoke.mockResolvedValue({ data: { success: true, results: many }, error: null });
    const controller = new AbortController();
    const response = await service.suggest('hotel avenida', { lat: 38.7, lon: -9.1 }, controller.signal);
    expect(invoke).toHaveBeenCalledWith('geocode-place', { body: { query: 'hotel avenida', mode: 'autocomplete', bias: { lat: 38.7, lon: -9.1 } }, signal: controller.signal });
    expect(response.results?.length).toBe(5);
    await service.suggest('hotel avenida', { lat: NaN, lon: 1 });
    expect(invoke.mock.calls[1][1]).toEqual({ body: { query: 'hotel avenida', mode: 'autocomplete' } });
  });

  it('cancelada en el navegador → «aborted» (quien llama lo ignora); errores del servidor conservan su código', async () => {
    const controller = new AbortController();
    invoke.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('abort', 'AbortError');
    });
    expect(await service.suggest('hotel avenida', null, controller.signal)).toEqual({ success: false, error: 'aborted' });
    invoke.mockResolvedValueOnce({ data: null, error: { context: { json: async () => ({ success: false, error: 'quota_exhausted', retryAfterSeconds: 3600, dailyLimit: 500 }) } } });
    expect(await service.suggest('hotel avenida')).toEqual({ success: false, error: 'quota_exhausted', retryAfterSeconds: 3600, dailyLimit: 500 });
  });

  it('mensajes de pausa: la búsqueda explícita sigue disponible', () => {
    expect(suggestionPauseMessage('quota_exhausted', 7200)).toContain('2 horas');
    expect(suggestionPauseMessage('quota_exhausted', 7200)).toContain('Buscar ubicación');
    expect(suggestionPauseMessage('provider_limited', 60)).toContain('1 minuto');
  });
});

describe('candidatePlace / placeSearchMessage', () => {
  it('convierte un candidato en un lugar validado (null → sin campos)', () => {
    expect(candidatePlace({ ...GOOD, bbox: null, osmType: null, osmId: null } as never)).toEqual({ provider: 'osm', lat: 38.69, lon: -9.21 });
    expect(candidatePlace({ ...GOOD, lon: 200 } as never)).toBeUndefined();
  });

  it('cada código tiene un mensaje para la asesora', () => {
    for (const code of ['invalid_query', 'query_too_long', 'busy', 'provider_limited', 'provider_blocked', 'quota_exhausted', 'timeout', 'provider_unavailable', 'provider_not_configured', 'forbidden', 'unauthorized', 'network_failure', undefined]) {
      expect(placeSearchMessage(code).length).toBeGreaterThan(10);
    }
    expect(placeSearchMessage('busy', 9)).toContain('9 segundos');
  });

  it('distingue la espera interna breve, el límite pedido por el proveedor, la pausa por defecto y el bloqueo', () => {
    const busy = placeSearchMessage('busy', 4);
    expect(busy).toContain('otras consultas');
    expect(busy).toContain('4 segundos');
    expect(busy).not.toContain('OpenStreetMap');

    const asked = placeSearchMessage('provider_limited', 90, { providerStatus: 429, retryAfterSource: 'provider' });
    expect(asked).toContain('El proveedor de búsqueda pidió esperar 2 minutos');
    expect(asked).toContain('HTTP 429');

    const byDefault = placeSearchMessage('provider_limited', 120, { providerStatus: 429, retryAfterSource: 'default' });
    expect(byDefault).toContain('El proveedor de búsqueda rechazó la búsqueda por límite de uso');
    expect(byDefault).toContain('sin indicar cuánto esperar');
    expect(byDefault).toContain('2 minutos');
    expect(byDefault).not.toContain('pidió esperar');

    const blocked = placeSearchMessage('provider_blocked', 300, { providerStatus: 403 });
    expect(blocked).toBe('El proveedor rechazó la solicitud del servidor. Contacta al administrador.');
    expect(blocked).not.toMatch(/exceso|demasiad/i); // un 403 no demuestra la causa

    expect(placeSearchMessage('provider_unavailable', 60, { providerStatus: 503 })).toContain('HTTP 503');
  });

  it('quota_exhausted: avisa del límite diario, aclara que lo ya buscado sigue disponible e indica cuándo se renueva', () => {
    const message = placeSearchMessage('quota_exhausted', 18_000, { dailyLimit: 500 });
    expect(message).toContain('límite diario de búsquedas nuevas (500)');
    expect(message).toContain('ya buscadas siguen disponibles');
    expect(message).toContain('5 horas');
    expect(message).not.toMatch(/OpenStreetMap|Nominatim|Geoapify/);
  });

  it('formatWait: segundos, minutos y horas con singular y plural', () => {
    expect([formatWait(1), formatWait(45), formatWait(60), formatWait(61), formatWait(3600), formatWait(7300), formatWait(86400), formatWait(90000)]).toEqual(['1 segundo', '45 segundos', '1 minuto', '2 minutos', '1 hora', '3 horas', '1 día', '2 días']);
  });

  it('el servicio conserva el estado real del proveedor y el origen del Retry-After', async () => {
    const invoke = vi.fn().mockResolvedValue({
      data: null,
      error: { context: { json: async () => ({ success: false, error: 'provider_limited', retryAfterSeconds: 30, providerStatus: 429, retryAfterSource: 'provider' }) } }
    });
    TestBed.configureTestingModule({ providers: [{ provide: SupabaseService, useValue: { client: { functions: { invoke } } } }] });
    const response = await TestBed.inject(PlaceSearchService).search('x y z');
    expect(response).toEqual({ success: false, error: 'provider_limited', retryAfterSeconds: 30, providerStatus: 429, retryAfterSource: 'provider' });
  });
});

describe('candidatePlace con procedencia', () => {
  const GEO = { provider: 'osm', geocoder: 'geoapify', placeId: 'abc123', osmType: null, osmId: null, name: 'Torre', address: 'Lisboa', lat: 38.69, lon: -9.21, bbox: null, dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'ODbL' };

  it('conserva geocodificador, id del proveedor, fuente, atribución y licencia, y NO inventa identificador OSM', () => {
    const place = candidatePlace(GEO as never)!;
    expect(place).toEqual({ provider: 'osm', lat: 38.69, lon: -9.21, geocoder: 'geoapify', placeId: 'abc123', dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'ODbL' });
    expect('osmId' in place).toBe(false);
  });

  it('una respuesta de la versión anterior (sin esos campos) sigue funcionando', () => {
    expect(candidatePlace({ provider: 'osm', osmType: 'way', osmId: 5, name: 'Torre', address: 'Lisboa', lat: 38.69, lon: -9.21, bbox: null } as never)).toEqual({ provider: 'osm', lat: 38.69, lon: -9.21, osmType: 'way', osmId: 5 });
  });
});
