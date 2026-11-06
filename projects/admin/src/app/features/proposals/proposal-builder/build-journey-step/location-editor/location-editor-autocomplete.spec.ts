// Autocompletado del editor de ubicación. El servicio de búsqueda es SIEMPRE simulado: nada de esto prueba al proveedor real.
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

const day = (id: string, n: number, over: Partial<ProposalDay> = {}): ProposalDay => ({
  id, dayNumber: n, title: `Día ${n}`, location: 'Lisboa', description: `Resumen ${n}`, imagePath: null,
  services: [{ id: `s${n}`, type: 'hotel', title: `Hotel ${n}`, description: 'Desc servicio', notes: '', time: '', imagePath: null, details: {} }],
  ...over
});

const cand = (id: number, name: string): PlaceCandidate => ({
  provider: 'osm', geocoder: 'geoapify', placeId: `p${id}`, osmType: null, osmId: null, name,
  address: `Rua ${id}, Lisboa`, city: 'Lisboa', country: 'Portugal', lat: 38.7 + id / 100, lon: -9.2 + id / 100,
  bbox: null, dataSource: 'openstreetmap', attribution: '© OpenStreetMap contributors', license: 'ODbL'
});
const FIVE = [1, 2, 3, 4, 5].map((i) => cand(i, `Hotel Avenida ${i}`));
const ok = (results: PlaceCandidate[]): PlaceSearchResponse => ({ success: true, results, cached: false });

describe('LocationEditor — sugerencias al escribir', () => {
  let proposals: { getById: ReturnType<typeof vi.fn>; updateContent: ReturnType<typeof vi.fn> };
  let places: { search: ReturnType<typeof vi.fn>; suggest: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<BuildJourneyStep>;
  const editor = (i: number) => fixture.debugElement.queryAll(By.directive(LocationEditor))[i].componentInstance as LocationEditor;
  const editorEl = (i: number) => fixture.debugElement.queryAll(By.directive(LocationEditor))[i].nativeElement as HTMLElement;
  const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
  const flush = async () => {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      fixture.detectChanges();
    }
  };
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const input = (i: number) => editorEl(i).querySelector('input[role=combobox]') as HTMLInputElement;
  const type = async (i: number, text: string) => {
    const el = input(i);
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await flush();
  };
  const key = async (i: number, k: string) => {
    input(i).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    await flush();
  };
  const wait = async (ms: number) => {
    await vi.advanceTimersByTimeAsync(ms);
    await flush();
  };
  const options = (i: number) => Array.from(editorEl(i).querySelectorAll('[role=option]')) as HTMLElement[];
  const openEditor = async (i: number) => {
    (editorEl(i).querySelector('.loc__add') as HTMLButtonElement).click();
    await flush();
  };
  const lastSaved = () => proposals.updateContent.mock.calls.at(-1)![1] as ProposalContent;

  async function create(days: ProposalDay[]): Promise<void> {
    proposals.getById.mockResolvedValue({ id: 'p1', kind: 'proposal', content: toProposalContent({ days }) });
    fixture = TestBed.createComponent(BuildJourneyStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.detectChanges();
    await settle();
  }

  beforeEach(() => {
    proposals = { getById: vi.fn(), updateContent: vi.fn() };
    places = { search: vi.fn(), suggest: vi.fn() };
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
  afterEach(() => vi.useRealTimers());

  it('no consulta al abrir el editor, al cargar el documento, al rellenar el campo desde datos guardados ni al enfocar', async () => {
    await create([day('d1', 1, { mapLocation: { name: 'Torre', place: { provider: 'osm', lat: 38.69, lon: -9.21 } } })]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await flush();
    await wait(5000);
    expect(places.suggest).not.toHaveBeenCalled();
    input(0).dispatchEvent(new Event('focus'));
    editor(0).query.setValue('hotel avenida lisboa'); // programático (p. ej. la sugerencia precargada): no es teclear
    await wait(5000);
    expect(places.suggest).not.toHaveBeenCalled();
    expect(places.search).not.toHaveBeenCalled();
  });

  it('desde 4 caracteres y tras 700 ms sin escribir: la escritura rápida produce UNA sola consulta (con el último texto)', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hot');
    await wait(2000);
    expect(places.suggest).not.toHaveBeenCalled(); // menos de 4 caracteres
    await type(0, 'hote');
    await wait(400);
    await type(0, 'hotel');
    await wait(400);
    await type(0, 'hotel ave');
    await wait(699);
    expect(places.suggest).not.toHaveBeenCalled();
    await wait(2);
    expect(places.suggest).toHaveBeenCalledTimes(1);
    expect(places.suggest.mock.calls[0][0]).toBe('hotel ave');
    expect(options(0).length).toBe(5);
    expect(options(0)[0].textContent).toContain('Hotel Avenida 1');
    expect(options(0)[0].textContent).toContain('Rua 1, Lisboa');
    expect(options(0)[0].textContent).toContain('Portugal');
    expect(places.search).not.toHaveBeenCalled();
  });

  it('respuestas fuera de orden: la obsoleta se descarta y la petición anterior se cancela en el navegador', async () => {
    const resolvers: ((r: PlaceSearchResponse) => void)[] = [];
    const signals: AbortSignal[] = [];
    places.suggest.mockImplementation((_q: string, _b: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return new Promise<PlaceSearchResponse>((resolve) => resolvers.push(resolve));
    });
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    await type(0, 'hotel avenida palace');
    expect(signals[0].aborted).toBe(true);
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(2);
    // Llega primero la respuesta de la segunda y después la (obsoleta) de la primera.
    resolvers[1](ok([cand(9, 'Avenida Palace')]));
    await flush();
    resolvers[0](ok(FIVE));
    await flush();
    expect(options(0).map((o) => o.querySelector('.loc__option-name')!.textContent)).toEqual(['Avenida Palace']);
  });

  it('una consulta idéntica no se repite (foco, flechas, volver al mismo texto)', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(1);
    await key(0, 'Escape');
    expect(options(0).length).toBe(0);
    input(0).dispatchEvent(new Event('focus'));
    await key(0, 'ArrowDown'); // reabre
    await flush();
    expect(options(0).length).toBe(5);
    await type(0, 'hotel avenida'); // el mismo texto escrito de nuevo
    await wait(700);
    expect(options(0).length).toBe(5);
    await type(0, 'hotel avenid');
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(2);
    await type(0, 'hotel avenida'); // vuelve a un texto ya consultado: memoria, sin llamar
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(2);
    expect(options(0).length).toBe(5);
  });

  it('teclado: flechas con vuelta, Enter elige la opción activa (sin elegir nunca la primera sola) y Escape cierra; ARIA de combobox', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    const box = input(0);
    expect(box.getAttribute('aria-expanded')).toBe('true');
    expect(box.getAttribute('aria-controls')).toBe(editorEl(0).querySelector('[role=listbox]')!.id);
    expect(box.getAttribute('aria-activedescendant')).toBeNull();
    await key(0, 'Enter'); // sin opción activa no elige nada
    expect(editor(0).pending()).toBeNull();
    await key(0, 'ArrowDown');
    expect(box.getAttribute('aria-activedescendant')).toBe(options(0)[0].id);
    expect(options(0)[0].getAttribute('aria-selected')).toBe('true');
    await key(0, 'ArrowUp'); // da la vuelta al final
    expect(box.getAttribute('aria-activedescendant')).toBe(options(0)[4].id);
    await key(0, 'ArrowDown');
    await key(0, 'ArrowDown');
    await key(0, 'Enter');
    expect(editor(0).pending()?.name).toBe('Hotel Avenida 2');
    expect(box.getAttribute('aria-expanded')).toBe('false');
    expect(editorEl(0).querySelector('.loc__pending')!.textContent).toContain('Hotel Avenida 2');
    expect(editorEl(0).querySelector('.loc__pending iframe')).not.toBeNull();
    expect(proposals.updateContent).not.toHaveBeenCalled();

    await type(0, 'hotel avenida palace');
    await wait(700);
    await key(0, 'Escape');
    expect(options(0).length).toBe(0);
    expect(box.getAttribute('aria-expanded')).toBe('false');
  });

  it('ratón: elegir una sugerencia la deja pendiente; «Confirmar ubicación» la pasa al borrador y solo «Guardar cambios» la guarda', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    options(0)[2].click();
    await flush();
    expect(editor(0).place()).toBeNull(); // todavía no está confirmada
    button(editorEl(0), 'Confirmar ubicación')!.click();
    await flush();
    expect(editor(0).place()?.placeId).toBe('p3');
    expect(editor(0).name.value).toBe('Hotel Avenida 3');
    expect(proposals.updateContent).not.toHaveBeenCalled();
    vi.useRealTimers();
    button(editorEl(0), 'Guardar cambios')!.click();
    await settle();
    const saved = lastSaved().days[0].mapLocation!;
    expect(saved.place?.placeId).toBe('p3');
    expect(saved.place?.geocoder).toBe('geoapify');
    expect(saved.place?.lat).toBeCloseTo(38.73, 5);
  });

  it('cambiar el texto después de elegir invalida la selección pendiente (no se puede confirmar algo que ya no corresponde)', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    options(0)[0].click();
    await flush();
    expect(button(editorEl(0), 'Confirmar ubicación')).toBeDefined();
    await type(0, 'otro hotel distinto');
    expect(editor(0).pending()).toBeNull();
    expect(button(editorEl(0), 'Confirmar ubicación')).toBeUndefined();
    editor(0).confirmPending(); // aunque se invoque, no hay nada que confirmar
    expect(editor(0).place()).toBeNull();
  });

  it('búsqueda manual: «Buscar ubicación» sigue funcionando, cancela las sugerencias en camino y cierra la lista', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    places.search.mockResolvedValue(ok([cand(1, 'Torre de Belém')]));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'torre de belem');
    await button(editorEl(0), 'Buscar ubicación')!.click();
    await wait(2000); // el temporizador pendiente se canceló: no hay sugerencias
    expect(places.suggest).not.toHaveBeenCalled();
    expect(places.search).toHaveBeenCalledTimes(1);
    expect(editorEl(0).querySelectorAll('.loc__result').length).toBe(1);
  });

  it('sin resultados: lo explica, deja seguir escribiendo y conserva la alternativa manual de Google', async () => {
    places.suggest.mockResolvedValue(ok([]));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'lugar inexistente');
    await wait(700);
    expect(editorEl(0).querySelector('.loc__popup-note')!.textContent).toContain('No encontramos sugerencias');
    expect(editorEl(0).querySelector('textarea')).not.toBeNull();
    expect(input(0).disabled).toBe(false);
  });

  it('error recuperable: lo muestra y NO reintenta solo; escribir de nuevo vuelve a consultar', async () => {
    places.suggest.mockResolvedValueOnce({ success: false, error: 'timeout' }).mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    expect(editorEl(0).querySelector('.loc__popup-note--error')!.textContent).toContain('tardó demasiado');
    await wait(10000);
    expect(places.suggest).toHaveBeenCalledTimes(1);
    await type(0, 'hotel avenida p');
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(2);
    expect(options(0).length).toBe(5);
  });

  it('cuota agotada: las sugerencias se detienen (sin reintentar al escribir) y «Buscar ubicación» sigue disponible', async () => {
    places.suggest.mockResolvedValue({ success: false, error: 'quota_exhausted', retryAfterSeconds: 7200, dailyLimit: 500 });
    places.search.mockResolvedValue(ok([cand(1, 'Torre de Belém')]));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    expect(editorEl(0).textContent).toContain('límite diario');
    expect(editorEl(0).textContent).toContain('«Buscar ubicación» sigue mostrando');
    await type(0, 'hotel avenida palace');
    await wait(5000);
    await type(0, 'hotel avenida palace lisboa');
    await wait(5000);
    expect(places.suggest).toHaveBeenCalledTimes(1);
    const search = button(editorEl(0), 'Buscar ubicación')!;
    expect(search.disabled).toBe(false);
    search.click();
    await flush();
    expect(places.search).toHaveBeenCalledTimes(1);
  });

  it('pausa del proveedor: se detienen las sugerencias durante el tiempo pedido y se reanudan después', async () => {
    places.suggest.mockResolvedValueOnce({ success: false, error: 'provider_limited', retryAfterSeconds: 60, retryAfterSource: 'provider' }).mockResolvedValue(ok(FIVE));
    await create([day('d1', 1)]);
    await openEditor(0);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(0, 'hotel avenida');
    await wait(700);
    expect(editorEl(0).textContent).toContain('pidió una pausa');
    await type(0, 'hotel avenida palace');
    await wait(30000);
    expect(places.suggest).toHaveBeenCalledTimes(1);
    await wait(31000);
    await type(0, 'hotel avenida palace lisboa');
    await wait(700);
    expect(places.suggest).toHaveBeenCalledTimes(2);
    expect(options(0).length).toBe(5);
  });

  it('preferencia geográfica: usa el lugar guardado del día para el servicio y solo si es fiable; sin lugar guardado no envía ninguna', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    await create([
      day('d1', 1, { mapLocation: { name: 'Lisboa', place: { provider: 'osm', lat: 38.7139, lon: -9.1394 } } }),
      day('d2', 2)
    ]);
    // Orden en el DOM: [día1, servicio1, día2, servicio2]
    await openEditor(1);
    await openEditor(3);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await type(1, 'hotel avenida');
    await wait(700);
    expect(places.suggest.mock.calls[0][1]).toEqual({ lat: 38.7139, lon: -9.1394 });
    await type(3, 'hotel avenida');
    await wait(700);
    expect(places.suggest.mock.calls[1][1]).toBeUndefined();
  });

  it('la ubicación guardada se conserva mientras se edita el borrador y solo cambia al guardar', async () => {
    places.suggest.mockResolvedValue(ok(FIVE));
    const saved = { name: 'Torre', place: { provider: 'osm' as const, lat: 38.69, lon: -9.21, placeId: 'old' } };
    await create([day('d1', 1, { mapLocation: saved })]);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await flush();
    await type(0, 'hotel avenida');
    await wait(700);
    options(0)[0].click();
    await flush();
    button(editorEl(0), 'Confirmar ubicación')!.click();
    await flush();
    expect(editor(0).place()?.placeId).toBe('p1');
    expect(editor(0).value()?.place?.placeId).toBe('old'); // lo guardado no cambia hasta guardar
    expect(proposals.updateContent).not.toHaveBeenCalled();
  });
});
