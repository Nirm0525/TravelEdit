import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { vi } from 'vitest';
import { BuildJourneyStep } from '../build-journey-step';
import { DayRecommendations } from './day-recommendations';
import { ProposalsService } from '../../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../../core/services/proposal-service-attachments';
import { ProposalContent, ProposalDay, toProposalContent } from '../../../../../core/models/proposal.model';

const day = (id: string, n: number, over: Partial<ProposalDay> = {}): ProposalDay => ({
  id, dayNumber: n, title: `Día ${n}`, location: '', description: `Resumen ${n}`, imagePath: null,
  services: [{ id: `s${n}`, type: 'hotel', title: `Hotel ${n}`, description: 'Desc servicio', notes: '', time: '', imagePath: null, details: {} }],
  ...over
});

describe('BuildJourneyStep — recomendaciones por día', () => {
  let proposals: { getById: ReturnType<typeof vi.fn>; updateContent: ReturnType<typeof vi.fn> };
  let fixture: ComponentFixture<BuildJourneyStep>;
  const el = () => fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  };
  const recs = (index: number) =>
    fixture.debugElement.queryAll(By.directive(DayRecommendations))[index].componentInstance as DayRecommendations;
  const button = (scope: ParentNode, label: string) =>
    Array.from(scope.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement | undefined;
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
    proposals.updateContent.mockImplementation(async (_id: string, c: ProposalContent) => ({ content: c }));
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: proposals },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null, upload: vi.fn() } },
        { provide: ProposalServiceAttachmentsService, useValue: { listForProposal: vi.fn().mockResolvedValue([]), removeService: vi.fn(), removeDay: vi.fn() } }
      ]
    });
  });

  it('un día sin recomendaciones solo ofrece «Añadir recomendaciones»: sin editor ni contenido predeterminado', async () => {
    await create([day('d1', 1), day('d2', 2)]);
    expect(el().querySelectorAll('.day-recs__add').length).toBe(2);
    expect(el().querySelectorAll('.day-recs').length).toBe(0);
    expect(proposals.updateContent).not.toHaveBeenCalled();
    expect(recs(0).headline.value).toBe('');
    expect(recs(0).body.value).toBe('');
  });

  it('añadir y guardar escribe SOLO las recomendaciones de ese día', async () => {
    await create([day('d1', 1), day('d2', 2)]);
    (el().querySelectorAll('.day-recs__add')[0] as HTMLButtonElement).click();
    await settle();
    recs(0).headline.setValue('Recomendaciones para tu visita a Londres');
    recs(0).body.setValue('<p>Lleva <strong>paraguas</strong></p>');
    recs(0).headline.markAsDirty();
    recs(0).body.markAsDirty();
    await settle();

    button(el().querySelector('.day-recs')!, 'Guardar cambios')!.click();
    await settle();

    expect(proposals.updateContent).toHaveBeenCalledTimes(1);
    const [d1, d2] = lastSaved().days;
    expect(d1.recommendations).toEqual({ headline: 'Recomendaciones para tu visita a Londres', body: '<p>Lleva <strong>paraguas</strong></p>' });
    expect(d1.description).toBe('Resumen 1');
    expect(d1.services[0].description).toBe('Desc servicio');
    expect('recommendations' in d2).toBe(false);
    expect(el().querySelector('.day-recs__status')?.textContent).toContain('Guardado');
  });

  it('recargar: las recomendaciones guardadas aparecen ya abiertas y editables', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } }), day('d2', 2)]);
    expect(el().querySelectorAll('.day-recs').length).toBe(1);
    expect(recs(0).headline.value).toBe('Londres');
    expect(recs(0).body.value).toBe('<p>Abrigo</p>');
    expect(el().querySelectorAll('.day-recs__add').length).toBe(1); // el día 2 sigue sin ellas
  });

  it('si el guardado falla se muestra el error y NO se pierde lo escrito; luego se puede reintentar', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } })]);
    recs(0).body.setValue('<p>Abrigo y paraguas</p>');
    recs(0).body.markAsDirty();
    proposals.updateContent.mockRejectedValueOnce(new Error('red'));

    button(el().querySelector('.day-recs')!, 'Guardar cambios')!.click();
    await settle();
    expect(el().querySelector('.day-recs .field__hint--error')?.textContent).toContain('No se pudieron guardar las recomendaciones');
    expect(recs(0).body.value).toBe('<p>Abrigo y paraguas</p>');

    button(el().querySelector('.day-recs')!, 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].recommendations?.body).toBe('<p>Abrigo y paraguas</p>');
    expect(el().querySelector('.day-recs .field__hint--error')).toBeNull();
  });

  it('editar y volver a guardar reemplaza lo anterior', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } })]);
    recs(0).headline.setValue('Londres y alrededores');
    recs(0).headline.markAsDirty();
    button(el().querySelector('.day-recs')!, 'Guardar cambios')!.click();
    await settle();
    expect(lastSaved().days[0].recommendations).toEqual({ headline: 'Londres y alrededores', body: '<p>Abrigo</p>' });
  });

  it('eliminar pide confirmación y quita la clave del día (el resto del día no cambia)', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } })]);
    button(el().querySelector('.day-recs')!, 'Eliminar recomendaciones')!.click();
    await settle();
    expect(proposals.updateContent).not.toHaveBeenCalled();
    (el().querySelector('.admin-modal__panel .btn--danger') as HTMLButtonElement).click();
    await settle();
    const saved = lastSaved().days[0];
    expect('recommendations' in saved).toBe(false);
    expect(saved.description).toBe('Resumen 1');
    expect(el().querySelectorAll('.day-recs').length).toBe(0);
    expect(el().querySelectorAll('.day-recs__add').length).toBe(1);
  });

  it('guardar con titular y texto vacíos quita las recomendaciones en vez de guardar un objeto vacío', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } })]);
    recs(0).headline.setValue('');
    recs(0).body.setValue('<p></p>');
    recs(0).headline.markAsDirty();
    button(el().querySelector('.day-recs')!, 'Guardar cambios')!.click();
    await settle();
    expect('recommendations' in lastSaved().days[0]).toBe(false);
  });

  it('editar otro campo del día no borra las recomendaciones guardadas', async () => {
    await create([day('d1', 1, { recommendations: { headline: 'Londres', body: '<p>Abrigo</p>' } })]);
    const title = el().querySelector('.day-card__title-input') as HTMLInputElement;
    title.value = 'Nuevo título';
    title.dispatchEvent(new Event('blur'));
    await settle();
    expect(lastSaved().days[0].title).toBe('Nuevo título');
    expect(lastSaved().days[0].recommendations).toEqual({ headline: 'Londres', body: '<p>Abrigo</p>' });
  });
});
