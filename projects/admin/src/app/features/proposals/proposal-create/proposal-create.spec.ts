import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { vi } from 'vitest';
import { ProposalCreate } from './proposal-create';
import { ProposalsService } from '../../../core/services/proposals';
import { TravelMode } from '../../travel/travel-config';

describe('ProposalCreate — el tipo se envía explícito', () => {
  let createDraft: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.spyOn>;

  function setup(mode: TravelMode): ProposalCreate {
    createDraft = vi.fn().mockResolvedValue({ id: 'new-1' });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { data: { mode } } } },
        { provide: ProposalsService, useValue: { createDraft } }
      ]
    });
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    return TestBed.runInInjectionContext(() => new ProposalCreate());
  }

  it('Nueva propuesta → kind = proposal, y abre el editor de propuestas', async () => {
    const component = setup('proposal');
    component.form.setValue({ clientName: 'Ana', destinationText: 'Chile' });
    await component.save();
    expect(createDraft).toHaveBeenCalledWith({ kind: 'proposal', clientName: 'Ana', destinationText: 'Chile' });
    expect(navigate).toHaveBeenCalledWith(['/viajes/propuestas', 'new-1', 'edit']);
  });

  it('Nuevo itinerario → kind = itinerary, y abre el editor de itinerarios', async () => {
    const component = setup('itinerary');
    component.form.setValue({ clientName: 'Ana', destinationText: '' });
    await component.save();
    expect(createDraft).toHaveBeenCalledWith({ kind: 'itinerary', clientName: 'Ana', destinationText: undefined });
    expect(navigate).toHaveBeenCalledWith(['/viajes/itinerarios', 'new-1', 'edit']);
  });

  it('textos del modo: «No se pudo crear el itinerario» si falla', async () => {
    const component = setup('itinerary');
    createDraft.mockRejectedValueOnce(new Error('x'));
    component.form.setValue({ clientName: 'Ana', destinationText: '' });
    await component.save();
    expect(component.error()).toBe('No se pudo crear el itinerario. Intenta de nuevo.');
  });
});
