import { MAX_PDF_BYTES, importStoragePath, pollImportStatus, validatePdfFile } from './pdf-import';

const file = (name: string, size: number, type = 'application/pdf') => ({ name, size, type });

describe('validatePdfFile', () => {
  it('acepta un PDF normal (también si el navegador no informa el tipo)', () => {
    expect(validatePdfFile(file('viaje.pdf', 1_000_000))).toBeNull();
    expect(validatePdfFile(file('VIAJE.PDF', 1_000_000, ''))).toBeNull();
  });

  it('rechaza lo que no es PDF, por extensión o por tipo', () => {
    expect(validatePdfFile(file('foto.png', 1000, 'image/png'))).toBe('Solo se aceptan archivos PDF (.pdf).');
    expect(validatePdfFile(file('doc.docx', 1000, 'application/msword'))).toBe('Solo se aceptan archivos PDF (.pdf).');
    expect(validatePdfFile(file('falso.pdf', 1000, 'text/html'))).toBe('Solo se aceptan archivos PDF (.pdf).');
    expect(validatePdfFile(file('sin-extension', 1000))).toBe('Solo se aceptan archivos PDF (.pdf).');
  });

  it('rechaza archivos vacíos y de más de 20 MB con un mensaje claro', () => {
    expect(validatePdfFile(file('a.pdf', 0))).toBe('El archivo está vacío.');
    expect(validatePdfFile(file('a.pdf', MAX_PDF_BYTES))).toBeNull(); // exactamente 20 MB sí
    expect(validatePdfFile(file('a.pdf', MAX_PDF_BYTES + 1))).toBe('El archivo pesa 20,0 MB y el máximo es 20 MB.');
    expect(validatePdfFile(file('grande.pdf', 25 * 1024 * 1024))).toBe('El archivo pesa 25,0 MB y el máximo es 20 MB.');
  });
});

describe('importStoragePath', () => {
  const UID = '11111111-1111-1111-1111-111111111111';

  it('es <uid>/<uuid>.pdf, en minúsculas y con la forma que exige la política de la base', () => {
    const path = importStoragePath(UID);
    expect(path).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/);
    expect(path.startsWith(`${UID}/`)).toBe(true);
  });

  it('pasa a minúsculas aunque el id llegue en mayúsculas, y nunca usa el nombre del archivo', () => {
    expect(importStoragePath('AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA', 'BBBBBBBB-BBBB-BBBB-BBBB-BBBBBBBBBBBB')).toBe(
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.pdf'
    );
    expect(importStoragePath(UID)).not.toBe(importStoragePath(UID)); // un uuid distinto cada vez
  });
});

describe('pollImportStatus', () => {
  /** Reloj falso: cada espera adelanta el tiempo, sin esperar de verdad. */
  function fakeClock() {
    let t = 0;
    const sleeps: number[] = [];
    return {
      now: () => t,
      sleep: (ms: number) => {
        sleeps.push(ms);
        t += ms;
        return Promise.resolve();
      },
      sleeps
    };
  }

  it('consulta cada 3 s y termina cuando el estado llega a ready', async () => {
    const clock = fakeClock();
    const states = ['uploaded', 'processing', 'processing', 'ready'];
    const result = await pollImportStatus(() => Promise.resolve({ status: states.shift()! }), clock);
    expect(result).toEqual({ status: 'ready' });
    expect(clock.sleeps).toEqual([3000, 3000, 3000]);
  });

  it('termina también con failed y con applied', async () => {
    expect(await pollImportStatus(() => Promise.resolve({ status: 'failed', error: 'x' }), fakeClock())).toEqual({ status: 'failed', error: 'x' });
    expect(await pollImportStatus(() => Promise.resolve({ status: 'applied' }), fakeClock())).toEqual({ status: 'applied' });
  });

  it('se rinde a los 3 minutos si sigue procesando', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollImportStatus(() => {
      calls++;
      return Promise.resolve({ status: 'processing' });
    }, clock);
    expect(result).toBe('timeout');
    expect(calls).toBe(61); // una consulta inicial + una cada 3 s durante 180 s
    expect(clock.now()).toBe(180_000);
  });

  it('se detiene si se cancela (la persona salió de la pantalla)', async () => {
    const clock = fakeClock();
    let calls = 0;
    const result = await pollImportStatus(
      () => {
        calls++;
        return Promise.resolve({ status: 'processing' });
      },
      { ...clock, cancelled: () => calls >= 2 }
    );
    expect(result).toBe('cancelled');
    expect(calls).toBe(2);
  });

  it('un error al consultar se propaga (la pantalla muestra el aviso)', async () => {
    await expect(pollImportStatus(() => Promise.reject(new Error('red caída')), fakeClock())).rejects.toThrow('red caída');
  });
});
