import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PreviewStep } from './preview-step';
import { ProposalsService } from '../../../../core/services/proposals';
import { ProposalImagesService } from '../../../../core/services/proposal-images';
import { ProposalServiceAttachmentsService } from '../../../../core/services/proposal-service-attachments';
import { toProposalContent } from '../../../../core/models/proposal.model';

const row = (stats?: unknown) => ({
  id: 'p1', kind: 'itinerary', status: 'shared', clientName: 'Isabella Rosales y Gabriel García', destinationText: 'Santiago de Chile, Bariloche',
  startDate: '2026-11-18', endDate: '2026-11-30', travelersCount: 2, currency: 'USD', publicToken: 't',
  content: toProposalContent({ cover: { title: 'Chile y Argentina', subtitle: 'Un viaje inolvidable', stats }, intro: { headline: 'Resumen', body: '<p>x</p>' }, days: [] }, 'itinerary')
});

describe('PreviewStep — portada y datos del resumen igual que el enlace del cliente', () => {
  async function render(stats?: unknown): Promise<HTMLElement> {
    window.matchMedia = ((query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
    TestBed.configureTestingModule({
      providers: [
        { provide: ProposalsService, useValue: { getById: vi.fn().mockResolvedValue(row(stats)) } },
        { provide: ProposalImagesService, useValue: { publicUrl: () => null } },
        { provide: ProposalServiceAttachmentsService, useValue: { listForProposal: vi.fn().mockResolvedValue([]), getUrl: vi.fn() } }
      ]
    });
    const fixture = TestBed.createComponent(PreviewStep);
    fixture.componentRef.setInput('proposalId', 'p1');
    fixture.componentRef.setInput('mode', 'itinerary');
    fixture.detectChanges();
    for (let i = 0; i < 8; i++) {
      await fixture.whenStable();
      fixture.detectChanges();
    }
    return fixture.nativeElement as HTMLElement;
  }
  const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const stat = (i: Element) => Array.from(i.querySelectorAll('p')).map((p) => text(p)).join(' ');

  it('la portada muestra destino, título, subtítulo, «Una experiencia diseñada para…» y fechas/viajeros como el cliente', async () => {
    const el = await render();
    const cover = text(el.querySelector('.preview__cover'));
    expect(cover).toContain('SANTIAGO DE CHILE, BARILOCHE');
    expect(cover).toContain('Chile y Argentina');
    expect(cover).toContain('Un viaje inolvidable');
    expect(cover).toContain('Una experiencia diseñada para Isabella Rosales y Gabriel García');
    expect(cover).toContain('18–30 noviembre 2026 · 2 viajeros');
  });

  it('sin texto escrito, los cuatro datos son los automáticos', async () => {
    const el = await render();
    const items = Array.from(el.querySelectorAll('.preview__summary-item')).map(stat);
    expect(items).toEqual(['13 días 12 noches', '2 viajeros', 'Otoño Noviembre 2026', 'Viaje a medida Experiencias únicas']);
  });

  it('lo escrito en la portada reemplaza al automático, campo por campo; lo vacío sigue siendo automático', async () => {
    const el = await render({ duration: { value: '13 días / 12 noches' }, season: { label: 'Primavera austral' }, custom: { value: 'Itinerario privado', label: 'Solo para ustedes' } });
    const items = Array.from(el.querySelectorAll('.preview__summary-item')).map(stat);
    expect(items).toEqual(['13 días / 12 noches 12 noches', '2 viajeros', 'Otoño Primavera austral', 'Itinerario privado Solo para ustedes']);
  });
});
