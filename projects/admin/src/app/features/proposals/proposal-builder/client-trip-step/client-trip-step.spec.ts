import { ComponentFixture, TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ClientTripStep } from './client-trip-step';
import { LeadsService } from '../../../../core/services/leads';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalsService } from '../../../../core/services/proposals';
import { TRAVEL_CONFIG, TravelMode } from '../../../travel/travel-config';

const proposal = {
  id: 'p1',
  clientName: 'Persona Ejemplo',
  clientEmail: 'persona@example.com',
  destinationText: 'Chile',
  startDate: '2026-11-18',
  endDate: '2026-11-30',
  travelersCount: 2,
  currency: 'USD',
  accessRequired: true,
  expiresAt: null,
  leadId: null,
  content: {
    cover: { title: 'T', subtitle: 'S', imagePath: null },
    welcome: { body: '' },
    intro: { headline: '', body: '' },
    terms: { title: '', body: '' },
    days: [],
    pricing: { lines: [], feesLines: [] },
    travelTips: []
  }
};

describe('ClientTripStep — capacidades por modo', () => {
  let fixture: ComponentFixture<ClientTripStep>;
  let service: { getById: ReturnType<typeof vi.fn>; hasAccessCode: ReturnType<typeof vi.fn> };
  const text = () => (fixture.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' ') ?? '';

  async function render(mode: TravelMode, section: 'client-trip' | 'cover' = 'client-trip') {
    service = { getById: vi.fn().mockResolvedValue(proposal), hasAccessCode: vi.fn().mockResolvedValue(true) };
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: service },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: LeadsService, useValue: { getById: vi.fn().mockResolvedValue(null) } }
      ]
    });
    fixture = TestBed.createComponent(ClientTripStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.componentRef.setInput('capabilities', TRAVEL_CONFIG[mode].capabilities);
    fixture.componentRef.setInput('activeSection', section);
    fixture.detectChanges();
    for (let i = 0; i < 6; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
  }

  it('itinerario: correo, acceso privado, código y vencimiento; sin moneda', async () => {
    await render('itinerary');
    expect(text()).toContain('Correo');
    expect(text()).toContain('Acceso privado');
    expect(text()).toContain('Requiere código de acceso');
    expect(text()).toContain('Expiración (opcional)');
    expect(text()).not.toContain('Moneda');
    expect(service.hasAccessCode).toHaveBeenCalled();
  });

  it('propuesta: sigue mostrando todo, incluida la moneda', async () => {
    await render('proposal');
    for (const t of ['Correo', 'Moneda', 'Acceso privado', 'Requiere código de acceso', 'Expiración (opcional)']) {
      expect(text()).toContain(t);
    }
  });

  describe('Portada → Datos del resumen', () => {
    const inputs = () => Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLInputElement>('.client-trip-step__stat input'));

    it('muestra los cuatro datos con lo automático como ayuda en gris', async () => {
      await render('itinerary', 'cover');
      expect(text()).toContain('Datos del resumen');
      expect(inputs().map((i) => i.placeholder)).toEqual([
        '13 días', '12 noches', '2 viajeros', 'Sin texto secundario', 'Otoño', 'Noviembre 2026', 'Viaje a medida', 'Experiencias únicas'
      ]);
    });

    it('guarda solo lo escrito dentro de content.cover.stats, sin tocar el resto de la portada', async () => {
      await render('itinerary', 'cover');
      const updateContent = vi.fn().mockImplementation(async (_id: string, content: unknown) => ({ ...proposal, content }));
      (service as unknown as Record<string, unknown>)['updateContent'] = updateContent;
      const [durationValue] = inputs();
      durationValue!.value = ' 14 días ';
      durationValue!.dispatchEvent(new Event('input'));
      durationValue!.dispatchEvent(new Event('blur'));
      await fixture.whenStable();
      const saved = updateContent.mock.calls.at(-1)![1] as { cover: Record<string, unknown> };
      expect(saved.cover).toEqual({ title: 'T', subtitle: 'S', imagePath: null, stats: { duration: { value: '14 días' } } });
    });
  });
});
