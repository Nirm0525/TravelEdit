import { fromDatetimeLocal, isPlausibleDatetimeLocal, toDatetimeLocal } from './datetime-local';

describe('datetime-local', () => {
  it('ida y vuelta: lo que se guarda es lo que se vuelve a mostrar, en cualquier zona horaria', () => {
    for (const value of ['2026-10-25T10:00', '2026-12-31T23:30', '2027-01-01T00:00', '2026-03-29T02:30']) {
      const iso = fromDatetimeLocal(value);
      expect(iso).not.toBeNull();
      expect(toDatetimeLocal(iso)).toBe(value);
    }
  });

  it('guardar varias veces no desplaza la fecha', () => {
    let value = '2026-10-25T10:00';
    for (let i = 0; i < 5; i++) {
      value = toDatetimeLocal(fromDatetimeLocal(value));
    }
    expect(value).toBe('2026-10-25T10:00');
  });

  it('la hora mostrada es la local del navegador, no la UTC (el error de slice(0, 16))', () => {
    const iso = new Date(2026, 9, 25, 10, 0).toISOString(); // 25 oct 2026, 10:00 hora local
    expect(toDatetimeLocal(iso)).toBe('2026-10-25T10:00');
    const offsetMinutes = new Date(2026, 9, 25, 10, 0).getTimezoneOffset();
    if (offsetMinutes !== 0) {
      expect(toDatetimeLocal(iso)).not.toBe(iso.slice(0, 16));
    }
  });

  it('vacío o inválido', () => {
    expect(toDatetimeLocal(null)).toBe('');
    expect(toDatetimeLocal('')).toBe('');
    expect(toDatetimeLocal('no es una fecha')).toBe('');
    expect(fromDatetimeLocal('')).toBeNull();
    expect(fromDatetimeLocal('no es una fecha')).toBeNull();
  });

  it('descarta valores a medias mientras se escribe el año', () => {
    expect(isPlausibleDatetimeLocal('0002-10-25T10:00')).toBe(false);
    expect(isPlausibleDatetimeLocal('0202-10-25T10:00')).toBe(false);
    expect(isPlausibleDatetimeLocal('2027-10-25T10:00')).toBe(true);
    expect(isPlausibleDatetimeLocal('')).toBe(false);
  });
});
