import { autoCoverStats, toCoverStats } from './cover-stats';

describe('cover-stats', () => {
  it('automático: días/noches, viajeros, temporada y «Viaje a medida»', () => {
    const auto = autoCoverStats('2026-11-18', '2026-11-30', 2);
    expect(auto.duration).toEqual({ value: '13 días', label: '12 noches' });
    expect(auto.travelers.value).toBe('2 viajeros');
    expect(auto.season).toEqual({ value: 'Otoño', label: 'Noviembre 2026' });
    expect(auto.custom).toEqual({ value: 'Viaje a medida', label: 'Experiencias únicas' });
  });

  it('sin fechas ni viajeros no se inventa nada', () => {
    const auto = autoCoverStats('', '', null);
    expect([auto.duration.value, auto.travelers.value, auto.season.value]).toEqual(['', '', '']);
  });

  it('solo se guarda lo escrito (recortado); sin nada escrito no hay stats', () => {
    expect(toCoverStats({ durationValue: '  14 días ', durationLabel: '', customLabel: 'Solo ustedes' })).toEqual({
      duration: { value: '14 días' },
      custom: { label: 'Solo ustedes' }
    });
    expect(toCoverStats({ durationValue: ' ', seasonLabel: '' })).toBeUndefined();
  });
});
