import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { PrivateProposal } from './private-proposal';
import { ProposalGateResponse, PublicProposalData, PublicProposalService, TravelKind } from '../../core/services/public-proposal';
import { toProposalContent } from '../../core/models/proposal-content.model';

const PB = '!1m18!1m12!1m3!1d3112.8!2d-9.2158!3d38.6916!5e0!3m2!1ses!2spt!4v1700000000000';
const EMBED = `https://www.google.com/maps/embed?pb=${PB}`;
const TOKEN = '31313131-3131-4131-8131-313131313131';
const SESSION = '41414141-4141-4141-8141-414141414141';
const service = { id: 's1', type: 'hotel', title: 'Hotel Faro', description: 'Descripción del hotel', notes: '', time: '', imagePath: null, details: {} };
const baseDay = { imagePath: null, location: '', description: '', services: [service] };

function data(kind: TravelKind, days: unknown[]): PublicProposalData {
  return {
    kind,
    content: toProposalContent({ cover: { title: 'Londres' }, days }),
    pricingSubtotal: 0, pricingFees: 0, pricingTotal: 0, currency: 'USD', status: kind === 'itinerary' ? 'shared' : 'published',
    termsAccepted: false, acceptedAt: null, clientName: 'Persona Ejemplo', destinationText: 'Londres', startDate: null, endDate: null,
    travelersCount: 2, serviceChoices: {}, serviceComments: {}
  };
}

describe('PrivateProposal — ubicaciones con mapa', { timeout: 20_000 }, () => {
  let api: Record<'getProposalGate' | 'verifyAccess' | 'getContent' | 'getDocuments' | 'getDocumentUrl', ReturnType<typeof vi.fn>>;
  let fixture: ComponentFixture<PrivateProposal>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };

  beforeEach(() => {
    sessionStorage.clear();
    vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
    api = {
      getProposalGate: vi.fn(),
      verifyAccess: vi.fn().mockResolvedValue({ result: 'ok', sessionToken: SESSION, sessionExpiresAt: new Date(Date.now() + 3600_000).toISOString() }),
      getContent: vi.fn(),
      getDocuments: vi.fn().mockResolvedValue([]),
      getDocumentUrl: vi.fn()
    };
    TestBed.configureTestingModule({ providers: [provideRouter([]), { provide: PublicProposalService, useValue: api }] });
  });
  afterEach(() => fixture?.destroy());
  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    vi.unstubAllGlobals();
  });

  async function open(kind: TravelKind, days: unknown[]): Promise<void> {
    const gate: ProposalGateResponse = { kind, accessRequired: false, clientName: 'Persona Ejemplo', coverTitle: 'Londres', coverImagePath: null, status: kind === 'itinerary' ? 'shared' : 'published' };
    api.getProposalGate.mockResolvedValue(gate);
    api.getContent.mockResolvedValue(data(kind, days));
    fixture = TestBed.createComponent(PrivateProposal);
    fixture.componentRef.setInput('token', TOKEN);
    fixture.detectChanges();
    await settle();
    fixture.componentInstance.itineraryExpanded.set(true);
    await settle();
  }

  for (const kind of ['itinerary', 'proposal'] as const) {
    it(`${kind}: la ubicación del día va tras la descripción y antes de los servicios; la del servicio tras su descripción; las recomendaciones al final`, async () => {
      const svc = { ...service, mapLocation: { name: 'Hotel Faro', address: 'Rua 1, Lisboa', embedUrl: EMBED } };
      await open(kind, [{
        ...baseDay, id: 'd1', dayNumber: 1, title: 'Llegada', description: 'Resumen', services: [svc],
        mapLocation: { name: 'Torre de Belém', address: 'Av. Brasília', embedUrl: EMBED },
        recommendations: { headline: 'Consejos', body: '<p>Texto</p>' }
      }]);
      const day = el().querySelector('.proposal__day')!;
      const locations = Array.from(day.querySelectorAll('app-map-location'));
      expect(locations.length).toBe(2);
      const [dayLoc, serviceLoc] = locations;
      const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(after(day.querySelector('.proposal__day-description')!, dayLoc)).toBe(true);
      expect(after(dayLoc, day.querySelector('.proposal__services')!)).toBe(true);
      expect(after(day.querySelector('.proposal__service-description')!, serviceLoc)).toBe(true);
      expect(after(serviceLoc, day.querySelector('app-day-recommendations')!)).toBe(true);

      expect(dayLoc.textContent).toContain('Torre de Belém');
      expect(dayLoc.textContent).toContain('Av. Brasília');
      const iframe = dayLoc.querySelector('iframe')!;
      expect(iframe.getAttribute('src')).toBe(EMBED);
      expect(iframe.getAttribute('title')).toBe('Mapa de Torre de Belém');
      expect(iframe.getAttribute('loading')).toBe('lazy');
      const link = dayLoc.querySelector('a')!;
      expect(link.textContent).toContain('Abrir en Google Maps');
      expect(link.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Torre%20de%20Bel%C3%A9m%2C%20Av.%20Bras%C3%ADlia');
      expect(link.getAttribute('rel')).toContain('noopener');
    });
  }

  it('sin ubicación (documentos antiguos, vacía o inválida) no hay bloque', async () => {
    await open('itinerary', [
      { ...baseDay, id: 'd1', dayNumber: 1, title: 'A' },
      { ...baseDay, id: 'd2', dayNumber: 2, title: 'B', mapLocation: { name: '  ' } },
      { ...baseDay, id: 'd3', dayNumber: 3, title: 'C', mapLocation: 'texto' }
    ]);
    expect(el().querySelectorAll('.proposal__day').length).toBe(3);
    expect(el().querySelector('app-map-location .map-location')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'https://evil.test/maps/embed?pb=x',
    'http://www.google.com/maps/embed?pb=x',
    'https://www.google.com/maps/embed/v1/place?key=K&q=x'
  ])('una URL de mapa no permitida (%s) no se carga, pero se conservan nombre, dirección y enlace', async (embedUrl) => {
    await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', address: 'Av. 1', embedUrl, html: '<script>1</script>' } }]);
    const loc = el().querySelector('app-map-location')!;
    expect(loc.querySelector('iframe')).toBeNull();
    expect(loc.textContent).toContain('Torre');
    expect(loc.textContent).toContain('Av. 1');
    expect(loc.querySelector('a')).toBeTruthy();
  });

  it('ubicación solo con nombre: sin mapa, con enlace', async () => {
    await open('proposal', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Hotel Avenida' } }]);
    const loc = el().querySelector('app-map-location')!;
    expect(loc.querySelector('iframe')).toBeNull();
    expect(loc.querySelector('a')?.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Hotel%20Avenida');
  });

  describe('lugar elegido con «Buscar ubicación» (OpenStreetMap)', () => {
    const PLACE = { provider: 'osm', lat: 38.6916, lon: -9.216, bbox: [38.6912, -9.2164, 38.692, -9.2156], osmType: 'way', osmId: 4391345 };
    const OSM = 'https://www.openstreetmap.org/export/embed.html?bbox=-9.218%2C38.6896%2C-9.214%2C38.6936&layer=mapnik&marker=38.6916%2C-9.216';

    for (const kind of ['itinerary', 'proposal'] as const) {
      it(`${kind}: el mapa se construye en código desde las coordenadas, con atribución, enlaces y el orden de siempre`, async () => {
        const svc = { ...service, mapLocation: { name: 'Hotel Faro', place: { provider: 'osm', lat: 38.7, lon: -9.2 } } };
        await open(kind, [{
          ...baseDay, id: 'd1', dayNumber: 1, title: 'Llegada', description: 'Resumen', services: [svc],
          mapLocation: { name: 'Torre de Belém', address: 'Av. Brasília', place: PLACE },
          recommendations: { headline: 'Consejos', body: '<p>Texto</p>' }
        }]);
        const day = el().querySelector('.proposal__day')!;
        const [dayLoc, serviceLoc] = Array.from(day.querySelectorAll('app-map-location'));
        const after = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
        expect(after(day.querySelector('.proposal__day-description')!, dayLoc)).toBe(true);
        expect(after(dayLoc, day.querySelector('.proposal__services')!)).toBe(true);
        expect(after(day.querySelector('.proposal__service-description')!, serviceLoc)).toBe(true);
        expect(after(serviceLoc, day.querySelector('app-day-recommendations')!)).toBe(true);

        const iframe = dayLoc.querySelector('iframe')!;
        expect(iframe.getAttribute('src')).toBe(OSM);
        expect(iframe.getAttribute('title')).toBe('Mapa de Torre de Belém');
        expect(iframe.getAttribute('loading')).toBe('lazy');
        expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox');
        expect(dayLoc.textContent).toContain('Torre de Belém');
        expect(dayLoc.textContent).toContain('Av. Brasília');
        const links = Array.from(dayLoc.querySelectorAll('a')) as HTMLAnchorElement[];
        expect(links.map((a) => a.textContent?.trim())).toEqual(['Abrir en Google Maps', 'Abrir en OpenStreetMap', '© OpenStreetMap contributors']);
        expect(links[0].getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=38.6916%2C-9.216');
        expect(links[1].getAttribute('href')).toBe('https://www.openstreetmap.org/?mlat=38.6916&mlon=-9.216#map=17/38.6916/-9.216');
        expect(links[2].getAttribute('href')).toBe('https://www.openstreetmap.org/copyright');
        for (const a of links) expect(a.getAttribute('rel')).toContain('noopener');
        // Un punto sin bbox usa un margen alrededor del punto.
        expect(serviceLoc.querySelector('iframe')!.getAttribute('src')).toContain('bbox=-9.204%2C38.696%2C-9.196%2C38.704');
      });
    }

    it.each([
      ['otro proveedor', { provider: 'google', lat: 1, lon: 2 }],
      ['latitud fuera de rango', { provider: 'osm', lat: 123, lon: 2 }],
      ['coordenadas como texto', { provider: 'osm', lat: '1', lon: '2' }],
      ['con campos de más (html)', { provider: 'x', lat: 1, lon: 2, html: '<script>1</script>' }]
    ])('un lugar inválido (%s) no carga mapa, pero se conservan nombre, dirección y enlace', async (_label, place) => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', address: 'Av. 1', place } }]);
      const loc = el().querySelector('app-map-location')!;
      expect(loc.querySelector('iframe')).toBeNull();
      expect(loc.textContent).toContain('Torre');
      expect(loc.textContent).toContain('Av. 1');
      expect(loc.textContent).not.toContain('OpenStreetMap');
      expect(loc.querySelector('a')?.getAttribute('href')).toBe('https://www.google.com/maps/search/?api=1&query=Torre%2C%20Av.%201');
    });

    it('un lugar inválido cae al mapa de Google guardado en el mismo documento', async () => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', place: { provider: 'x', lat: 1, lon: 2 }, embedUrl: EMBED } }]);
      expect(el().querySelector('app-map-location iframe')!.getAttribute('src')).toBe(EMBED);
    });

    it('los mapas de Google guardados antes no cambian: mismo iframe, mismo enlace y sin atribución de OpenStreetMap', async () => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', address: 'Av. 1', embedUrl: EMBED } }]);
      const loc = el().querySelector('app-map-location')!;
      expect(loc.querySelector('iframe')!.getAttribute('src')).toBe(EMBED);
      expect(Array.from(loc.querySelectorAll('a')).map((a) => a.textContent?.trim())).toEqual(['Abrir en Google Maps']);
      expect(loc.textContent).not.toContain('OpenStreetMap');
    });

    it('si el mapa externo no carga, el nombre, la dirección, los enlaces y la atribución siguen visibles (no dependen del iframe)', async () => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', address: 'Av. 1', place: PLACE } }]);
      const loc = el().querySelector('app-map-location')!;
      loc.querySelector('iframe')!.remove();
      expect(loc.textContent).toContain('Torre');
      expect(loc.textContent).toContain('© OpenStreetMap contributors');
      expect(loc.querySelectorAll('a').length).toBe(3);
    });
  });

  describe('lugar buscado con Geoapify: procedencia y atribución', () => {
    const GEO = { provider: 'osm', lat: 38.691586, lon: -9.215929, geocoder: 'geoapify', placeId: 'abc123', dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License' };

    for (const kind of ['itinerary', 'proposal'] as const) {
      it(`${kind}: el mapa OSM muestra las coordenadas elegidas con la atribución de OpenStreetMap y «Powered by Geoapify» junto a la información`, async () => {
        await open(kind, [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre de Belém', address: 'Av. Brasília', place: GEO } }]);
        const loc = el().querySelector('app-map-location')!;
        expect(loc.querySelector('iframe')!.getAttribute('src')).toContain('https://www.openstreetmap.org/export/embed.html?bbox=');
        const credit = loc.querySelector('.map-location__attribution')!;
        expect(credit.textContent!.replace(/\s+/g, ' ').trim()).toBe('© OpenStreetMap contributors · Powered by Geoapify');
        const links = Array.from(credit.querySelectorAll('a')) as HTMLAnchorElement[];
        expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://www.openstreetmap.org/copyright', 'https://www.geoapify.com/']);
        for (const a of links) {
          expect(a.getAttribute('rel')).toContain('noopener');
          expect(a.getAttribute('target')).toBe('_blank');
        }
        // La atribución no depende del iframe: se conserva aunque el mapa externo no cargue.
        loc.querySelector('iframe')!.remove();
        expect(loc.querySelector('.map-location__attribution')!.textContent).toContain('Powered by Geoapify');
      });
    }

    it('un resultado sin identificador OSM (lo normal en Geoapify) se muestra igual: no se supone ningún osmId', async () => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Hotel', place: GEO } }]);
      const loc = el().querySelector('app-map-location')!;
      expect(loc.querySelector('iframe')).not.toBeNull();
      expect(loc.querySelector('a[href^="https://www.openstreetmap.org/?mlat="]')).not.toBeNull();
      expect(JSON.stringify(GEO)).not.toContain('osmId');
    });

    it('otra fuente de datos informada por el proveedor se muestra como texto plano (nunca HTML)', async () => {
      const place = { ...GEO, attribution: '<img src=x onerror=alert(1)>© OpenAddresses contributors' };
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Calle', place } }]);
      const credit = el().querySelector('app-map-location .map-location__attribution')!;
      expect(credit.textContent).toContain('Datos: img src=x onerror=alert(1) © OpenAddresses contributors');
      expect(credit.querySelector('img')).toBeNull();
    });

    it('los lugares guardados antes (sin geocoder) y los mapas de Google no muestran ningún crédito de Geoapify', async () => {
      await open('itinerary', [{ ...baseDay, id: 'd1', dayNumber: 1, title: 'A', mapLocation: { name: 'Torre', place: { provider: 'osm', lat: 38.69, lon: -9.21, osmType: 'way', osmId: 9 } } },
        { ...baseDay, id: 'd2', dayNumber: 2, title: 'B', mapLocation: { name: 'Torre', embedUrl: EMBED } }]);
      expect(el().textContent).not.toContain('Geoapify');
    });
  });
});
