import {
  ProposalDay,
  hasDayRecommendations,
  isRichTextEmpty,
  normalizeDayRecommendations,
  toProposalContent,
  withDayRecommendations
} from './proposal.model';

const day = (over: Partial<ProposalDay> = {}): ProposalDay => ({
  id: 'd1', dayNumber: 1, title: 'Londres', location: '', description: 'Resumen', imagePath: null, services: [], ...over
});

describe('recomendaciones del día (modelo)', () => {
  it('el texto vacío del editor (<p></p>) cuenta como vacío; una imagen sola no', () => {
    expect(isRichTextEmpty('')).toBe(true);
    expect(isRichTextEmpty(undefined)).toBe(true);
    expect(isRichTextEmpty('<p></p>')).toBe(true);
    expect(isRichTextEmpty('<p>&nbsp; </p>')).toBe(true);
    expect(isRichTextEmpty('<p>Lleva paraguas</p>')).toBe(false);
    expect(isRichTextEmpty('<p><img src="https://x.test/a.jpg"></p>')).toBe(false);
  });

  it('normalizar: sin titular ni texto no se guarda nada; con uno de los dos, sí', () => {
    expect(normalizeDayRecommendations('  ', '<p></p>')).toBeUndefined();
    expect(normalizeDayRecommendations(' Londres ', '<p></p>')).toEqual({ headline: 'Londres', body: '' });
    expect(normalizeDayRecommendations('', '<p>Abrigo</p>')).toEqual({ headline: '', body: '<p>Abrigo</p>' });
  });

  it('hasDayRecommendations: días anteriores al campo y bloques vacíos no cuentan', () => {
    expect(hasDayRecommendations(day())).toBe(false);
    expect(hasDayRecommendations(day({ recommendations: { headline: '', body: '<p></p>' } }))).toBe(false);
    expect(hasDayRecommendations(day({ recommendations: { headline: 'Hola', body: '' } }))).toBe(true);
  });

  it('withDayRecommendations pone o QUITA la clave y no toca el resumen ni los servicios', () => {
    const base = day({ description: 'Resumen del día' });
    const withRecs = withDayRecommendations(base, { headline: 'H', body: '<p>B</p>' });
    expect(withRecs.recommendations).toEqual({ headline: 'H', body: '<p>B</p>' });
    expect(withRecs.description).toBe('Resumen del día');
    const removed = withDayRecommendations(withRecs, undefined);
    expect('recommendations' in removed).toBe(false);
  });

  it('se conservan al recargar el contenido (propuesta e itinerario) y los días viejos siguen válidos', () => {
    const raw = { days: [day({ recommendations: { headline: 'H', body: '<p>B</p>' } }), day({ id: 'd2', dayNumber: 2 })] };
    for (const kind of ['proposal', 'itinerary'] as const) {
      const content = toProposalContent(JSON.parse(JSON.stringify(raw)), kind);
      expect(content.days[0].recommendations).toEqual({ headline: 'H', body: '<p>B</p>' });
      expect(content.days[1].recommendations).toBeUndefined();
    }
  });
});
