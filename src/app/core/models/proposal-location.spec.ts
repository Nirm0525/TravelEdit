import { googleMapsSearchUrl, normalizeMapLocation, osmEmbedUrl, osmOpenUrl, placeCredits, toSafeMapLocation, toSafePlace, validateEmbedUrl } from './proposal-location';

const PB = '!1m18!1m12!1m3!1d3112.8!2d-9.2158!3d38.6916!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0xd1ecb7!2sTorre%20de%20Bel%C3%A9m!5e0!3m2!1ses!2spt!4v1700000000000!5m2!1ses!2spt';
const URL_OK = `https://www.google.com/maps/embed?pb=${PB}`;
const IFRAME = `<iframe src="${URL_OK}" width="600" height="450" style="border:0;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe>`;

describe('validateEmbedUrl', () => {
  it('acepta la URL de «Insertar un mapa» y la normaliza', () => {
    expect(validateEmbedUrl(URL_OK)).toBe(URL_OK);
    expect(validateEmbedUrl(`${URL_OK}&extra=1#frag`)).toBe(URL_OK);
  });

  it.each([
    ['http', URL_OK.replace('https', 'http')],
    ['host parecido', `https://www.google.com.evil.com/maps/embed?pb=${PB}`],
    ['host con prefijo', `https://evilwww.google.com/maps/embed?pb=${PB}`],
    ['subdominio', `https://maps.google.com/maps/embed?pb=${PB}`],
    ['sin www', `https://google.com/maps/embed?pb=${PB}`],
    ['credenciales', `https://user:pw@www.google.com/maps/embed?pb=${PB}`],
    ['puerto', `https://www.google.com:8443/maps/embed?pb=${PB}`],
    ['otra ruta', `https://www.google.com/maps/place/Lisboa?pb=${PB}`],
    ['ruta con prefijo', `https://www.google.com/maps/embedX?pb=${PB}`],
    ['v1 (requiere key)', 'https://www.google.com/maps/embed/v1/place?key=K&q=Lisboa'],
    ['sin pb', 'https://www.google.com/maps/embed'],
    ['pb duplicado', `${URL_OK}&pb=${PB}`],
    ['pb con caracteres raros', 'https://www.google.com/maps/embed?pb=a"onload=alert(1)'],
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>1</script>'],
    ['otro proveedor', 'https://www.openstreetmap.org/export/embed.html?bbox=1,2,3,4'],
    ['no es texto', 42]
  ])('rechaza %s', (_label, value) => {
    expect(validateEmbedUrl(value)).toBeNull();
  });
});

describe('normalizeMapLocation / toSafeMapLocation', () => {
  it('sin nombre no hay ubicación; no se guardan campos vacíos', () => {
    expect(normalizeMapLocation('  ', 'Calle 1', URL_OK)).toBeUndefined();
    expect(normalizeMapLocation(' Torre ', ' ', null)).toEqual({ name: 'Torre' });
    expect(normalizeMapLocation('Torre', 'Av. 1', URL_OK)).toEqual({ name: 'Torre', address: 'Av. 1', embedUrl: URL_OK });
  });

  it('al leer: ignora basura, campos desconocidos (como html) y URL inválidas conservando nombre y dirección', () => {
    expect(toSafeMapLocation(undefined)).toBeUndefined();
    expect(toSafeMapLocation('x')).toBeUndefined();
    expect(toSafeMapLocation({ name: '' })).toBeUndefined();
    expect(toSafeMapLocation({ name: 'Torre', html: IFRAME, embedUrl: 'javascript:alert(1)' })).toEqual({ name: 'Torre' });
    expect(toSafeMapLocation({ name: 'Torre', address: 7, embedUrl: URL_OK })).toEqual({ name: 'Torre', embedUrl: URL_OK });
  });
});

describe('googleMapsSearchUrl', () => {
  it('codifica nombre y dirección sin deducir coordenadas', () => {
    expect(googleMapsSearchUrl({ name: 'Torre de Belém', address: 'Av. Brasília & Cía' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=Torre%20de%20Bel%C3%A9m%2C%20Av.%20Bras%C3%ADlia%20%26%20C%C3%ADa'
    );
    expect(googleMapsSearchUrl({ name: 'Torre' })).toBe('https://www.google.com/maps/search/?api=1&query=Torre');
  });
});

describe('lugar elegido con «Buscar ubicación» (OpenStreetMap)', () => {
  const PLACE = { provider: 'osm', lat: 38.6916, lon: -9.216, bbox: [38.6912, -9.2164, 38.692, -9.2156], osmType: 'way', osmId: 4391345 };

  it('toSafePlace conserva solo campos conocidos y válidos', () => {
    expect(toSafePlace({ ...PLACE, html: '<script>1</script>', extra: 1 })).toEqual(PLACE);
    expect(toSafePlace({ provider: 'osm', lat: 1, lon: 2 })).toEqual({ provider: 'osm', lat: 1, lon: 2 });
    expect(toSafePlace({ ...PLACE, osmType: 'planet', osmId: -4 })).toEqual({ provider: 'osm', lat: 38.6916, lon: -9.216, bbox: PLACE.bbox });
  });

  it.each([
    ['otro proveedor', { ...PLACE, provider: 'google' }],
    ['sin proveedor', { lat: 1, lon: 2 }],
    ['latitud fuera de rango', { ...PLACE, lat: 90.5 }],
    ['longitud fuera de rango', { ...PLACE, lon: -180.1 }],
    ['coordenadas como texto', { ...PLACE, lat: '38.6', lon: '-9.2' }],
    ['NaN', { ...PLACE, lat: Number.NaN }],
    ['Infinity', { ...PLACE, lon: Infinity }],
    ['no es objeto', 'osm'],
    ['null', null]
  ])('toSafePlace rechaza %s', (_label, value) => {
    expect(toSafePlace(value)).toBeUndefined();
    expect(osmEmbedUrl(value)).toBeNull();
    expect(osmOpenUrl(value)).toBeNull();
  });

  it('un bbox incoherente (desordenado, fuera de rango o sin contener el punto) se descarta pero el lugar se conserva', () => {
    for (const bbox of [[39, -9.3, 38, -9.1], [38, -9.3, 39, -9.5], [38, -190, 39, -9], [10, 10, 11, 11], [1, 2, 3], 'x']) {
      expect(toSafePlace({ ...PLACE, bbox })).toEqual({ provider: 'osm', lat: 38.6916, lon: -9.216, osmType: 'way', osmId: 4391345 });
    }
  });

  it('osmEmbedUrl construye la URL desde el código: host y ruta exactos, bbox (oeste,sur,este,norte) y marcador', () => {
    const url = new URL(osmEmbedUrl(PLACE)!);
    expect([url.protocol, url.hostname, url.pathname, url.port, url.username]).toEqual(['https:', 'www.openstreetmap.org', '/export/embed.html', '', '']);
    expect(url.searchParams.get('layer')).toBe('mapnik');
    expect(url.searchParams.get('marker')).toBe('38.6916,-9.216');
    // El bbox de un edificio (≈ 90 m) se amplía a un recuadro mínimo para que el mapa no quede demasiado cerca.
    expect(url.searchParams.get('bbox')).toBe('-9.218,38.6896,-9.214,38.6936');
    expect([...url.searchParams.keys()].sort()).toEqual(['bbox', 'layer', 'marker']);
  });

  it('osmEmbedUrl: sin bbox usa un margen alrededor del punto; un bbox grande se respeta; nunca sale de rango', () => {
    expect(new URL(osmEmbedUrl({ provider: 'osm', lat: 10, lon: 20 })!).searchParams.get('bbox')).toBe('19.996,9.996,20.004,10.004');
    expect(new URL(osmEmbedUrl({ provider: 'osm', lat: 40.4, lon: -3.7, bbox: [40.3, -3.8, 40.5, -3.6] })!).searchParams.get('bbox')).toBe('-3.8,40.3,-3.6,40.5');
    expect(new URL(osmEmbedUrl({ provider: 'osm', lat: 89.999, lon: 179.999 })!).searchParams.get('bbox')).toBe('179.995,89.995,180,90');
  });

  it('osmOpenUrl abre OpenStreetMap con el marcador en las coordenadas', () => {
    expect(osmOpenUrl(PLACE)).toBe('https://www.openstreetmap.org/?mlat=38.6916&mlon=-9.216#map=17/38.6916/-9.216');
  });

  it('normalizeMapLocation: lugar y código de Google son excluyentes (manda el lugar); sin lugar válido se conserva el código', () => {
    expect(normalizeMapLocation('Torre', 'Av. 1', URL_OK, PLACE as never)).toEqual({ name: 'Torre', address: 'Av. 1', place: PLACE });
    expect(normalizeMapLocation('Torre', '', URL_OK, null)).toEqual({ name: 'Torre', embedUrl: URL_OK });
    expect(normalizeMapLocation('Torre', '', URL_OK, { ...PLACE, lat: 500 } as never)).toEqual({ name: 'Torre', embedUrl: URL_OK });
    expect(normalizeMapLocation(' ', '', null, PLACE as never)).toBeUndefined();
  });

  it('toSafeMapLocation: los mapas de Google guardados antes siguen siendo válidos; un lugar inválido cae al código de Google', () => {
    expect(toSafeMapLocation({ name: 'Torre', address: 'Av. 1', embedUrl: URL_OK })).toEqual({ name: 'Torre', address: 'Av. 1', embedUrl: URL_OK });
    expect(toSafeMapLocation({ name: 'Torre', place: PLACE })).toEqual({ name: 'Torre', place: PLACE });
    expect(toSafeMapLocation({ name: 'Torre', place: PLACE, embedUrl: URL_OK })).toEqual({ name: 'Torre', place: PLACE });
    expect(toSafeMapLocation({ name: 'Torre', place: { ...PLACE, provider: 'x' }, embedUrl: URL_OK })).toEqual({ name: 'Torre', embedUrl: URL_OK });
    expect(toSafeMapLocation({ name: 'Torre', place: { provider: 'osm', lat: 'x', lon: 1 } })).toEqual({ name: 'Torre' });
  });

  it('googleMapsSearchUrl: con lugar usa sus coordenadas; sin lugar, el nombre y la dirección', () => {
    expect(googleMapsSearchUrl({ name: 'Torre', place: PLACE })).toBe('https://www.google.com/maps/search/?api=1&query=38.6916%2C-9.216');
    expect(googleMapsSearchUrl({ name: 'Torre', place: { ...PLACE, lat: 500 } })).toBe('https://www.google.com/maps/search/?api=1&query=Torre');
  });
});

describe('procedencia y atribución del lugar (Geoapify)', () => {
  const PLACE = { provider: 'osm', lat: 38.6916, lon: -9.216 };

  it('toSafePlace conserva la procedencia validada y NO inventa identificador OSM', () => {
    const place = toSafePlace({
      ...PLACE,
      geocoder: 'geoapify',
      placeId: '51a1b2c3d4e5',
      dataSource: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      license: 'Open Database License',
      html: '<script>1</script>'
    });
    expect(place).toEqual({
      provider: 'osm',
      lat: 38.6916,
      lon: -9.216,
      geocoder: 'geoapify',
      placeId: '51a1b2c3d4e5',
      dataSource: 'openstreetmap',
      attribution: '© OpenStreetMap contributors',
      license: 'Open Database License'
    });
    expect(place && 'osmId' in place).toBe(false);
    expect(place && 'osmType' in place).toBe(false);
  });

  it('un lugar guardado antes (sin geocoder ni procedencia) sigue siendo válido', () => {
    expect(toSafePlace({ ...PLACE, osmType: 'way', osmId: 9 })).toEqual({ provider: 'osm', lat: 38.6916, lon: -9.216, osmType: 'way', osmId: 9 });
  });

  it.each([
    ['geocoder desconocido', { geocoder: 'google' }],
    ['placeId con caracteres raros', { placeId: '../../x' }],
    ['placeId demasiado largo', { placeId: 'a'.repeat(201) }]
  ])('descarta %s sin invalidar el lugar', (_label, extra) => {
    const place = toSafePlace({ ...PLACE, ...extra })!;
    expect(place.lat).toBe(38.6916);
    expect(place.geocoder).toBeUndefined();
    expect(place.placeId).toBeUndefined();
  });

  it('el texto del proveedor se limpia (sin «<», «>» ni control) y se recorta; nunca HTML', () => {
    const place = toSafePlace({ ...PLACE, dataSource: 'x'.repeat(100), attribution: '<b>© Datos</b> ' + 'y'.repeat(400), license: '<i>L</i>\u0000' })!;
    expect(place.dataSource!.length).toBe(40);
    expect(place.attribution!.length).toBe(200);
    expect(/[<>]/.test(place.attribution!)).toBe(false);
    expect(/[<> ]/.test(place.license!)).toBe(false);
    expect(toSafePlace({ ...PLACE, attribution: '<>', dataSource: 7 })).toEqual({ provider: 'osm', lat: 38.6916, lon: -9.216 });
  });

  it('placeCredits: Geoapify añade su crédito; una fuente distinta de OpenStreetMap se muestra; OSM y lugares antiguos no añaden nada', () => {
    expect(placeCredits({ ...PLACE, geocoder: 'geoapify' })).toEqual({ geoapify: true, dataAttribution: null });
    expect(placeCredits({ ...PLACE, geocoder: 'geoapify', attribution: '© OpenStreetMap contributors' })).toEqual({ geoapify: true, dataAttribution: null });
    expect(placeCredits({ ...PLACE, geocoder: 'geoapify', attribution: '© OpenAddresses contributors' })).toEqual({ geoapify: true, dataAttribution: '© OpenAddresses contributors' });
    expect(placeCredits({ ...PLACE, geocoder: 'nominatim' })).toEqual({ geoapify: false, dataAttribution: null });
    expect(placeCredits(PLACE)).toEqual({ geoapify: false, dataAttribution: null });
    expect(placeCredits({ provider: 'google', lat: 1, lon: 2, geocoder: 'geoapify' })).toEqual({ geoapify: false, dataAttribution: null });
    expect(placeCredits(undefined)).toEqual({ geoapify: false, dataAttribution: null });
  });

  it('la procedencia sobrevive a normalizeMapLocation y toSafeMapLocation (se guarda con el lugar)', () => {
    const place = { ...PLACE, geocoder: 'geoapify', placeId: 'abc', attribution: '© OpenStreetMap contributors' };
    const saved = normalizeMapLocation('Torre', 'Av. 1', null, place as never)!;
    expect(saved.place).toEqual(place);
    expect(toSafeMapLocation(JSON.parse(JSON.stringify(saved)))!.place).toEqual(place);
  });
});
