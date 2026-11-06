import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { BuildJourneyStep } from '../build-journey-step';
import { LocationEditor } from './location-editor';
import { ProposalsService } from '../../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../../core/services/proposal-service-attachments';
import { PlaceCandidate, PlaceSearchResponse, PlaceSearchService } from '../../../../../core/services/place-search';
import { ProposalContent, ProposalDay, toProposalContent } from '../../../../../core/models/proposal.model';

const PB = '!1m18!1m12!1m3!1d3112.8!2d-9.2158!3d38.6916!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!5e0!3m2!1ses!2spt!4v1700000000000';
const EMBED = `https://www.google.com/maps/embed?pb=${PB}`;
const IFRAME = `<iframe src="${EMBED}" width="600" height="450" style="border:0;" loading="lazy"></iframe>`;

const day = (id: string, n: number, over: Partial<ProposalDay> = {}): ProposalDay => ({
  id, dayNumber: n, title: `Día ${n}`, location: 'Lisboa', description: `Resumen ${n}`, imagePath: null,
  services: [{ id: `s${n}`, type: 'hotel', title: `Hotel ${n}`, description: 'Desc servicio', notes: '', time: '', imagePath: null, details: {} }],
  ...over
});

describe('BuildJourneyStep — ubicaciones con mapa', () => {
  let proposals: { getById: ReturnType<typeof vi.fn>; updateContent: ReturnType<typeof vi.fn> };
  let places: { search: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<BuildJourneyStep>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  /** Orden en el DOM: [día1, servicio1, día2, servicio2, …]. */
  const editor = (index: number) => fixture.debugElement.queryAll(By.directive(LocationEditor))[index].componentInstance as LocationEditor;
  const editorEl = (index: number) => fixture.debugElement.queryAll(By.directive(LocationEditor))[index].nativeElement as HTMLElement;
  const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const lastSaved = () => proposals.updateContent.mock.calls.at(-1)![1] as ProposalContent;
  const fill = (e: LocationEditor, name: string, address: string, embed: string) => {
    e.name.setValue(name);
    e.address.setValue(address);
    e.embed.setValue(embed);
    e.name.markAsDirty();
    e.address.markAsDirty();
    e.embed.markAsDirty();
  };

  async function create(days: ProposalDay[]): Promise<void> {
    proposals.getById.mockResolvedValue({ id: 'p1', kind: 'proposal', content: toProposalContent({ days }) });
    fixture = TestBed.createComponent(BuildJourneyStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    proposals = { getById: vi.fn(), updateContent: vi.fn() };
    places = { search: vi.fn() };
    proposals.updateContent.mockImplementation(async (_id: string, c: ProposalContent) => ({ content: c }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: proposals },
        { provide: PlaceSearchService, useValue: places },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null, upload: vi.fn() } },
        { provide: ProposalServiceAttachmentsService, useValue: { listForProposal: vi.fn().mockResolvedValue([]), removeService: vi.fn(), removeDay: vi.fn() } }
      ]
    });
  });

  it('documentos antiguos: solo se ofrece «Añadir ubicación» (día y servicio), sin editor ni guardado', async () => {
    await create([day('d1', 1)]);
    expect(el().querySelectorAll('.loc__add').length).toBe(2);
    expect(el().querySelectorAll('.loc').length).toBe(0);
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });

  it('añadir con iframe pegado: previsualiza el mapa, guarda solo la URL normalizada y no el HTML', async () => {
    await create([day('d1', 1)]);
    (el().querySelectorAll('.loc__add')[0] as HTMLButtonElement).click();
    await settle();
    expect(el().textContent).toContain('Compartir → Insertar un mapa → Copiar HTML');
    fill(editor(0), 'Torre de Belém', 'Av. Brasília', IFRAME);
    await settle();

    const iframe = editorEl(0).querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe(EMBED);
    expect(iframe.getAttribute('title')).toBe('Mapa de Torre de Belém');
    expect(iframe.getAttribute('loading')).toBe('lazy');

    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();

    expect(proposals.updateContent).toHaveBeenCalledTimes(1);
    const [d1] = lastSaved().days;
    expect(d1.mapLocation).toEqual({ name: 'Torre de Belém', address: 'Av. Brasília', embedUrl: EMBED });
    expect(JSON.stringify(lastSaved())).not.toContain('<iframe');
    expect(d1.location).toBe('Lisboa');
    expect(d1.services[0].mapLocation).toBeUndefined();
    expect(editorEl(0).querySelector('.loc__status')?.textContent).toContain('Guardado');
  });

  it('un enlace normal o HTML no permitido muestra una explicación, no se carga y no se puede guardar', async () => {
    await create([day('d1', 1)]);
    (el().querySelectorAll('.loc__add')[0] as HTMLButtonElement).click();
    await settle();
    fill(editor(0), 'Torre', '', 'https://maps.app.goo.gl/abc123');
    await settle();
    expect(editorEl(0).querySelector('.field__hint--error')?.textContent).toContain('enlace normal');
    expect(editorEl(0).querySelector('iframe')).toBeNull();
    expect(button(editorEl(0), 'Guardar cambios')!.disabled).toBe(true);

    editor(0).embed.setValue('<script>alert(1)</script><iframe src="https://evil.test/x"></iframe>');
    await settle();
    expect(editorEl(0).querySelector('iframe')).toBeNull();
    expect(editorEl(0).querySelector('script')).toBeNull();
    expect(button(editorEl(0), 'Guardar cambios')!.disabled).toBe(true);
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });

  it('sin nombre no se guarda; el mapa es opcional (nombre solo basta)', async () => {
    await create([day('d1', 1)]);
    (el().querySelectorAll('.loc__add')[0] as HTMLButtonElement).click();
    await settle();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(editorEl(0).querySelector('.field__hint--error')?.textContent).toContain('nombre');
    expect(proposals.updateContent).not.toHaveBeenCalled();

    fill(editor(0), 'Hotel Avenida', '', '');
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Hotel Avenida' });
  });

  it('servicio: guarda la ubicación solo en ese servicio', async () => {
    await create([day('d1', 1), day('d2', 2)]);
    (editorEl(3).querySelector('.loc__add') as HTMLButtonElement).click();
    await settle();
    fill(editor(3), 'Aeropuerto', 'Terminal 1', EMBED);
    button(editorEl(3), 'Guardar cambios')!.click();
    await settle();
    const [d1, d2] = lastSaved().days;
    expect(d2.services[0].mapLocation).toEqual({ name: 'Aeropuerto', address: 'Terminal 1', embedUrl: EMBED });
    expect(d2.services[0].description).toBe('Desc servicio');
    expect(d1.mapLocation).toBeUndefined();
    expect(d1.services[0].mapLocation).toBeUndefined();
  });

  it('recargar: lo guardado aparece abierto; editar reemplaza y eliminar quita la clave tras confirmar', async () => {
    await create([day('d1', 1, { mapLocation: { name: 'Torre', embedUrl: EMBED } })]);
    expect(editorEl(0).querySelector('.loc')).not.toBeNull();
    expect(editor(0).name.value).toBe('Torre');
    expect(editor(0).embed.value).toBe(EMBED);

    editor(0).name.setValue('Torre de Belém');
    editor(0).name.markAsDirty();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Torre de Belém', embedUrl: EMBED });

    button(editorEl(0), 'Eliminar ubicación')!.click();
    await settle();
    (el().querySelector('.admin-modal__panel .btn--danger') as HTMLButtonElement).click();
    await settle();
    expect('mapLocation' in lastSaved().days[0]).toBe(false);
    expect(lastSaved().days[0].description).toBe('Resumen 1');
  });

  it('si el guardado falla conserva lo escrito y permite reintentar', async () => {
    await create([day('d1', 1)]);
    (el().querySelectorAll('.loc__add')[0] as HTMLButtonElement).click();
    await settle();
    fill(editor(0), 'Torre', 'Av. 1', IFRAME);
    proposals.updateContent.mockRejectedValueOnce(new Error('red'));
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(editorEl(0).querySelector('.field__hint--error')?.textContent).toContain('No se pudo guardar la ubicación');
    expect(editor(0).name.value).toBe('Torre');
    expect(editor(0).embed.value).toBe(IFRAME);

    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation?.name).toBe('Torre');
  });

  it('guardados simultáneos (ubicación de día + ubicación de servicio + título) no se pisan', async () => {
    await create([day('d1', 1)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    proposals.updateContent.mockImplementationOnce(async (_id: string, c: ProposalContent) => {
      await gate;
      return { content: c };
    });
    const step = fixture.componentInstance;
    const d = step.days()[0];
    const first = step.saveDayLocation(d, { name: 'Torre', embedUrl: EMBED });
    const second = step.saveServiceLocation(d, d.services[0], { name: 'Hotel' });
    const input = document.createElement('input');
    input.value = 'Nuevo título';
    const third = step.onDayFieldBlur(d, 'title', { target: input } as unknown as Event);
    release();
    await Promise.all([first, second, third]);

    const saved = lastSaved().days[0];
    expect(saved.mapLocation).toEqual({ name: 'Torre', embedUrl: EMBED });
    expect(saved.services[0].mapLocation).toEqual({ name: 'Hotel' });
    expect(saved.title).toBe('Nuevo título');
  });

  // ---------------------------------------------------------------- «Buscar ubicación» (Nominatim / OpenStreetMap)

  const cand = (id: number, name: string, lat: number, lon: number): PlaceCandidate => ({
    provider: 'osm', osmType: 'way', osmId: id, name, address: 'Av. Brasília, Lisboa, Portugal', lat, lon,
    bbox: [lat - 0.0004, lon - 0.0004, lat + 0.0004, lon + 0.0004]
  });
  const THREE = [cand(1, 'Torre de Belém', 38.6916, -9.216), cand(2, 'Torre de Belém (réplica)', 38.7, -9.2), cand(3, 'Belém Tower Hotel', 38.71, -9.19)];
  const ok = (results: PlaceCandidate[]): PlaceSearchResponse => ({ success: true, results, cached: false, attribution: '© OpenStreetMap contributors' });
  const openEditor = async (index: number) => {
    (editorEl(index).querySelector('.loc__add') as HTMLButtonElement).click();
    await settle();
  };
  const runSearch = async (index: number, query?: string) => {
    if (query !== undefined) editor(index).query.setValue(query);
    button(editorEl(index), 'Buscar ubicación')!.click();
    await settle();
  };
  const radios = (index: number) => Array.from(editorEl(index).querySelectorAll('input[type=radio]')) as HTMLInputElement[];
  const OSM_SRC = /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=/;

  it('la consulta se precarga con nombre, dirección y ciudad (editable) y escribir NO consulta al proveedor', async () => {
    await create([day('d1', 1, { services: [{ id: 's1', type: 'hotel', title: 'Hotel Avenida', description: '', notes: '', time: '', imagePath: null, details: { address: 'Rua 1, 23' } }] })]);
    await openEditor(0);
    expect(editor(0).query.value).toBe('Lisboa');
    await openEditor(1);
    expect(editor(1).query.value).toBe('Hotel Avenida, Rua 1, 23, Lisboa');
    editor(1).query.setValue('hotel avenida palace, lisboa');
    editor(1).query.markAsDirty();
    await settle();
    expect(editor(1).query.value).toBe('hotel avenida palace, lisboa');
    expect(places.search).not.toHaveBeenCalled();
  });

  it('buscar solo con el botón: muestra hasta 3 candidatos con nombre, dirección y mapa; elegir y confirmar NO guarda; guardar sí', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre de belém, lisboa');

    expect(places.search).toHaveBeenCalledTimes(1);
    expect(places.search).toHaveBeenCalledWith('torre de belém, lisboa');
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(3);
    const frames = Array.from(editorEl(0).querySelectorAll('.loc__result iframe')) as HTMLIFrameElement[];
    expect(frames.length).toBe(3);
    for (const f of frames) expect(f.getAttribute('src')).toMatch(OSM_SRC);
    expect(editorEl(0).textContent).toContain('Torre de Belém (réplica)');
    expect(editorEl(0).textContent).toContain('Av. Brasília, Lisboa, Portugal');
    expect(editorEl(0).textContent).toContain('© OpenStreetMap contributors');
    // El primer resultado no se elige solo.
    expect(button(editorEl(0), 'Confirmar esta ubicación')!.disabled).toBe(true);
    expect(radios(0).every((r) => !r.checked)).toBe(true);

    radios(0)[1].click();
    await settle();
    expect(button(editorEl(0), 'Confirmar esta ubicación')!.disabled).toBe(false);
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    expect(proposals.updateContent).not.toHaveBeenCalled();
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(0);
    expect(editor(0).name.value).toBe('Torre de Belém (réplica)');
    expect((editorEl(0).querySelector('.loc__preview iframe') as HTMLIFrameElement).getAttribute('src')).toMatch(OSM_SRC);

    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(proposals.updateContent).toHaveBeenCalledTimes(1);
    const saved = lastSaved().days[0];
    expect(saved.mapLocation).toEqual({
      name: 'Torre de Belém (réplica)',
      address: 'Av. Brasília, Lisboa, Portugal',
      place: { provider: 'osm', lat: 38.7, lon: -9.2, bbox: [38.6996, -9.2004, 38.7004, -9.1996], osmType: 'way', osmId: 2 }
    });
    expect('embedUrl' in saved.mapLocation!).toBe(false);
    expect(JSON.stringify(lastSaved())).not.toContain('<iframe');
    expect(saved.description).toBe('Resumen 1');
    expect(editorEl(0).querySelector('.loc__status')?.textContent).toContain('Guardado');
  });

  it('confirmar conserva el nombre y la dirección que ya escribió la asesora', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    editor(0).name.setValue('Mi hotel favorito');
    editor(0).name.markAsDirty();
    editor(0).address.setValue('Calle propia 5');
    editor(0).address.markAsDirty();
    await runSearch(0, 'torre de belém, lisboa');
    radios(0)[0].click();
    await settle();
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toMatchObject({ name: 'Mi hotel favorito', address: 'Calle propia 5', place: { provider: 'osm', osmId: 1 } });
  });

  it('consulta ambigua: se pueden comparar 3 resultados y cambiar la selección antes de confirmar', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre belém');
    radios(0)[0].click();
    await settle();
    radios(0)[2].click();
    await settle();
    expect(radios(0).map((r) => r.checked)).toEqual([false, false, true]);
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    expect(editor(0).place()?.osmId).toBe(3);
  });

  it('sin resultados: avisa, deja corregir la consulta y mantiene el método manual', async () => {
    places.search.mockResolvedValueOnce(ok([])).mockResolvedValueOnce(ok([THREE[0]]));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'lugar inexistente zzz');
    expect(editorEl(0).textContent).toContain('No encontramos resultados para «lugar inexistente zzz»');
    expect(editorEl(0).querySelector('.loc__result')).toBeNull();
    expect(editorEl(0).querySelector('textarea')).not.toBeNull();
    expect(editorEl(0).textContent).toContain('Compartir → Insertar un mapa → Copiar HTML');

    await runSearch(0, 'torre de belém, lisboa');
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(1);
    expect(places.search).toHaveBeenCalledTimes(2);
  });

  it('error o límite del proveedor: muestra el motivo, no pierde lo escrito y permite reintentar', async () => {
    places.search
      .mockResolvedValueOnce({ success: false, error: 'busy', retryAfterSeconds: 5 })
      .mockResolvedValueOnce({ success: false, error: 'timeout' })
      .mockRejectedValueOnce(new Error('red'))
      .mockResolvedValueOnce(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    editor(0).name.setValue('Torre');
    editor(0).name.markAsDirty();
    await runSearch(0, 'torre de belém');
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('5 segundos');
    editor(0).cooldownUntil.set(0); // pasó la espera breve
    await settle();
    await runSearch(0);
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('tardó demasiado');
    await runSearch(0);
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('No se pudo buscar');
    expect(editor(0).name.value).toBe('Torre');
    expect(editor(0).query.value).toBe('torre de belém');
    await runSearch(0);
    expect(editorEl(0).querySelector('.field__hint--error')).toBeNull();
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(3);
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });

  it('pausa del proveedor: el botón queda desactivado con cuenta atrás, NO se reintenta solo y se reactiva al pasar la espera', async () => {
    places.search.mockResolvedValue({ success: false, error: 'provider_limited', retryAfterSeconds: 120, providerStatus: 429, retryAfterSource: 'default' });
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre de belém');
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('sin indicar cuánto esperar');
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('2 minutos');
    expect(Array.from(editorEl(0).querySelectorAll('button')).map((b) => b.textContent?.trim())).toContain('Disponible en 2:00');
    const waiting = button(editorEl(0), 'Disponible en 2:00')!;
    expect(waiting.disabled).toBe(true);

    waiting.click();
    await editor(0).search();
    await settle();
    expect(places.search).toHaveBeenCalledTimes(1); // ni con clic ni por código

    editor(0).cooldownUntil.set(Date.now() - 1); // pasó la pausa (el reloj del componente avanza con su intervalo de 1 s)
    editor(0)['clock'].set(Date.now());
    await settle();
    expect(button(editorEl(0), 'Buscar ubicación')!.disabled).toBe(false);
    expect(places.search).toHaveBeenCalledTimes(1); // y sigue sin reintentarse solo
  });

  it('Retry-After de 2 h: el contador visual se limita («más de 1 h») pero el bloqueo usa la espera COMPLETA', async () => {
    places.search.mockResolvedValue({ success: false, error: 'provider_limited', retryAfterSeconds: 7200, providerStatus: 429, retryAfterSource: 'provider' });
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre de belém');
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('2 horas');
    const waiting = button(editorEl(0), 'Disponible en más de 1 h')!;
    expect(waiting.disabled).toBe(true);
    // Pasada 1 h sigue bloqueado: la espera guardada es la completa.
    expect(editor(0).cooldownUntil() - Date.now()).toBeGreaterThan(7_190_000);
    editor(0)['clock'].set(Date.now() + 3_700_000);
    await settle();
    expect(editor(0).cooldownSeconds()).toBeGreaterThan(3_400);
    const remaining = Array.from(editorEl(0).querySelectorAll('button')).find((b) => b.textContent?.trim().startsWith('Disponible en 58:'))!;
    expect(remaining.disabled).toBe(true); // quedan ~3500 s: ya cabe en el contador, y sigue bloqueado
    await editor(0).search();
    expect(places.search).toHaveBeenCalledTimes(1);
  });

  it('distingue en pantalla: espera interna breve, límite pedido por el proveedor y bloqueo (403)', async () => {
    places.search
      .mockResolvedValueOnce({ success: false, error: 'busy', retryAfterSeconds: 4 })
      .mockResolvedValueOnce({ success: false, error: 'provider_limited', retryAfterSeconds: 30, providerStatus: 429, retryAfterSource: 'provider' })
      .mockResolvedValueOnce({ success: false, error: 'provider_blocked', retryAfterSeconds: 300, providerStatus: 403, retryAfterSource: 'default' });
    await create([day('d1', 1)]);
    await openEditor(0);
    const alertText = () => editorEl(0).querySelector('[role=alert]')?.textContent ?? '';

    await runSearch(0, 'torre de belém');
    expect(alertText()).toContain('otras consultas');
    expect(alertText()).not.toContain('OpenStreetMap');
    editor(0).cooldownUntil.set(0);
    await settle();

    await runSearch(0);
    expect(alertText()).toContain('El proveedor de búsqueda pidió esperar 30 segundos');
    editor(0).cooldownUntil.set(0);
    await settle();

    await runSearch(0);
    expect(alertText()).toBe('El proveedor rechazó la solicitud del servidor. Contacta al administrador.');
    expect(alertText()).not.toContain('pidió esperar');
  });

  const GEO = (id: string, name: string): PlaceCandidate => ({
    provider: 'osm', geocoder: 'geoapify', placeId: id, osmType: null, osmId: null, name, address: 'Av. Brasília, Lisboa, Portugal', lat: 38.6916, lon: -9.216,
    bbox: [38.6912, -9.2164, 38.692, -9.2156], dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License'
  });

  it('Geoapify: la búsqueda muestra la atribución, se elige y confirma sin guardar, y se guarda con su procedencia (sin identificador OSM inventado)', async () => {
    places.search.mockResolvedValue(ok([GEO('p1', 'Torre de Belém'), GEO('p2', 'Torre (réplica)')]));
    await create([day('d1', 1)]);
    await openEditor(0);
    expect(editorEl(0).querySelector('.loc__credit')?.textContent).toContain('Geoapify');
    expect(editorEl(0).querySelector('.loc__credit a')?.getAttribute('href')).toBe('https://www.geoapify.com/');

    await runSearch(0, 'torre de belém, lisboa');
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(2);
    // Cada tarjeta muestra la atribución de OpenStreetMap y «Powered by Geoapify».
    const credits = editorEl(0).querySelector('.loc__result .map-location__attribution')!.textContent!;
    expect(credits).toContain('© OpenStreetMap contributors');
    expect(credits).toContain('Powered by Geoapify');

    radios(0)[0].click();
    await settle();
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    expect(proposals.updateContent).not.toHaveBeenCalled();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    const saved = lastSaved().days[0].mapLocation!;
    expect(saved.place).toEqual({
      provider: 'osm', lat: 38.6916, lon: -9.216, bbox: [38.6912, -9.2164, 38.692, -9.2156],
      geocoder: 'geoapify', placeId: 'p1', dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'Open Database License'
    });
    expect('osmId' in saved.place!).toBe(false);
    expect(JSON.stringify(lastSaved())).not.toContain('apiKey');
    expect(JSON.stringify(lastSaved())).not.toContain('<iframe');
  });

  it('Geoapify: al recargar se usa lo guardado (no se vuelve a buscar) y se conserva la procedencia al editar', async () => {
    const place = { provider: 'osm' as const, lat: 38.6916, lon: -9.216, geocoder: 'geoapify' as const, placeId: 'p1', dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors' };
    await create([day('d1', 1, { mapLocation: { name: 'Torre', address: 'Av. 1', place } })]);
    expect(places.search).not.toHaveBeenCalled();
    expect(editor(0).place()).toEqual(place);
    expect(editorEl(0).querySelector('.loc__preview .map-location__attribution')?.textContent).toContain('Powered by Geoapify');
    editor(0).name.setValue('Torre de Belém');
    editor(0).name.markAsDirty();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Torre de Belém', address: 'Av. 1', place });
    expect(places.search).not.toHaveBeenCalled();
  });

  it('límite diario agotado: avisa para búsquedas nuevas, NO desactiva el botón (lo cacheado sigue funcionando) y no pierde lo escrito', async () => {
    places.search
      .mockResolvedValueOnce({ success: false, error: 'quota_exhausted', retryAfterSeconds: 18_000, retryAfterSource: 'default', dailyLimit: 500 })
      .mockResolvedValueOnce(ok([GEO('p1', 'Torre de Belém')]));
    await create([day('d1', 1)]);
    await openEditor(0);
    editor(0).name.setValue('Mi lugar');
    editor(0).name.markAsDirty();
    await runSearch(0, 'lugar nuevo sin caché');
    const alertText = editorEl(0).querySelector('[role=alert]')?.textContent ?? '';
    expect(alertText).toContain('límite diario de búsquedas nuevas (500)');
    expect(alertText).toContain('ya buscadas siguen disponibles');
    expect(button(editorEl(0), 'Buscar ubicación')!.disabled).toBe(false);
    expect(editor(0).name.value).toBe('Mi lugar');

    await runSearch(0, 'torre de belém, lisboa'); // una búsqueda ya cacheada responde aunque el límite esté agotado
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(1);
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });

  it('consulta demasiado corta: no se envía; mientras busca, un segundo clic no duplica la consulta', async () => {
    let release!: (r: PlaceSearchResponse) => void;
    places.search.mockImplementation(() => new Promise<PlaceSearchResponse>((resolve) => (release = resolve)));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'ab');
    expect(places.search).not.toHaveBeenCalled();
    expect(editorEl(0).querySelector('[role=alert]')?.textContent).toContain('al menos 3');

    editor(0).query.setValue('torre de belém');
    button(editorEl(0), 'Buscar ubicación')!.click();
    await settle();
    expect(button(editorEl(0), 'Buscando…')!.disabled).toBe(true);
    await editor(0).search();
    expect(places.search).toHaveBeenCalledTimes(1);
    release(ok(THREE));
    await settle();
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(3);
  });

  it('recargar: un lugar guardado se muestra abierto con su mapa; editar conserva el lugar y eliminar quita la clave', async () => {
    const place = { provider: 'osm' as const, lat: 38.6916, lon: -9.216, osmType: 'way' as const, osmId: 4391345 };
    await create([day('d1', 1, { mapLocation: { name: 'Torre', address: 'Av. 1', place } })]);
    expect(editorEl(0).querySelector('.loc')).not.toBeNull();
    expect(editor(0).place()).toEqual(place);
    expect((editorEl(0).querySelector('.loc__preview iframe') as HTMLIFrameElement).getAttribute('src')).toMatch(OSM_SRC);

    editor(0).name.setValue('Torre de Belém');
    editor(0).name.markAsDirty();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Torre de Belém', address: 'Av. 1', place });

    button(editorEl(0), 'Eliminar ubicación')!.click();
    await settle();
    (el().querySelector('.admin-modal__panel .btn--danger') as HTMLButtonElement).click();
    await settle();
    expect('mapLocation' in lastSaved().days[0]).toBe(false);
  });

  it('compatibilidad: un mapa de Google guardado antes se sigue mostrando; elegir un lugar lo sustituye y pegar un código sustituye al lugar', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1, { mapLocation: { name: 'Torre', embedUrl: EMBED } })]);
    expect((editorEl(0).querySelector('.loc__preview iframe') as HTMLIFrameElement).getAttribute('src')).toBe(EMBED);

    await runSearch(0, 'torre de belém');
    radios(0)[0].click();
    await settle();
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    expect(editor(0).embed.value).toBe('');
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toMatchObject({ name: 'Torre', place: { provider: 'osm', osmId: 1 } });
    expect('embedUrl' in lastSaved().days[0].mapLocation!).toBe(false);

    editor(0).embed.setValue(IFRAME);
    editor(0).embed.markAsDirty();
    await settle();
    expect(editor(0).place()).toBeNull();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Torre', address: 'Av. Brasília, Lisboa, Portugal', embedUrl: EMBED });
  });

  it('quitar el mapa elegido deja la ubicación solo con nombre y dirección', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre de belém');
    radios(0)[0].click();
    await settle();
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    button(editorEl(0), 'Quitar el mapa elegido')!.click();
    await settle();
    expect(editorEl(0).querySelector('.loc__preview iframe')).toBeNull();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation).toEqual({ name: 'Torre de Belém', address: 'Av. Brasília, Lisboa, Portugal' });
  });

  it('si el guardado de un lugar elegido falla conserva el lugar y permite reintentar', async () => {
    places.search.mockResolvedValue(ok(THREE));
    await create([day('d1', 1)]);
    await openEditor(0);
    await runSearch(0, 'torre de belém');
    radios(0)[0].click();
    await settle();
    button(editorEl(0), 'Confirmar esta ubicación')!.click();
    await settle();
    proposals.updateContent.mockRejectedValueOnce(new Error('red'));
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(editorEl(0).textContent).toContain('No se pudo guardar la ubicación');
    expect(editor(0).place()?.osmId).toBe(1);
    expect(editorEl(0).querySelector('.loc__preview iframe')).not.toBeNull();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].mapLocation?.place?.osmId).toBe(1);
  });

  it('guardados simultáneos de lugares (día + servicio + título) no se pisan', async () => {
    await create([day('d1', 1)]);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    proposals.updateContent.mockImplementationOnce(async (_id: string, c: ProposalContent) => {
      await gate;
      return { content: c };
    });
    const step = fixture.componentInstance;
    const d = step.days()[0];
    const first = step.saveDayLocation(d, { name: 'Torre', place: { provider: 'osm', lat: 38.69, lon: -9.21, osmId: 7 } });
    const second = step.saveServiceLocation(d, d.services[0], { name: 'Hotel', place: { provider: 'osm', lat: 38.7, lon: -9.2 } });
    const third = step.onDayFieldBlur(d, 'title', { target: Object.assign(document.createElement('input'), { value: 'Nuevo título' }) } as unknown as Event);
    release();
    await Promise.all([first, second, third]);
    const saved = lastSaved().days[0];
    expect(saved.mapLocation?.place).toEqual({ provider: 'osm', lat: 38.69, lon: -9.21, osmId: 7 });
    expect(saved.services[0].mapLocation?.place).toEqual({ provider: 'osm', lat: 38.7, lon: -9.2 });
    expect(saved.title).toBe('Nuevo título');
  });
});
