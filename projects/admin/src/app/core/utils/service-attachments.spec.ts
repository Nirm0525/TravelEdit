import {
  ATTACHMENT_MAX_BYTES,
  displayNameWithoutExtension,
  formatFileSize,
  validateAttachmentFile
} from './service-attachments';

const file = (name: string, type: string, size = 1000) => ({ name, type, size });

describe('validateAttachmentFile', () => {
  it('acepta PDF, JPEG, PNG y WebP con su extensión', () => {
    for (const f of [
      file('Boleto.pdf', 'application/pdf'),
      file('foto.JPG', 'image/jpeg'),
      file('foto.jpeg', 'image/jpeg'),
      file('captura.png', 'image/png'),
      file('voucher.webp', 'image/webp')
    ]) {
      expect(validateAttachmentFile(f)).toBeNull();
    }
  });

  it('rechaza tipos no permitidos (DOCX, SVG, HTML, vacío)', () => {
    for (const type of ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/svg+xml', 'text/html', '']) {
      expect(validateAttachmentFile(file('a.pdf', type))).toContain('Tipo de archivo no permitido');
    }
  });

  it('rechaza una extensión que no coincide con el tipo', () => {
    expect(validateAttachmentFile(file('a.exe', 'application/pdf'))).toContain('extensión');
    expect(validateAttachmentFile(file('a', 'application/pdf'))).toContain('extensión');
    expect(validateAttachmentFile(file('a.png', 'application/pdf'))).toContain('extensión');
  });

  it('rechaza vacío y más de 10 MB; justo 10 MB pasa', () => {
    expect(validateAttachmentFile(file('a.pdf', 'application/pdf', 0))).toContain('vacío');
    expect(validateAttachmentFile(file('a.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES + 1))).toContain('máximo es 10 MB');
    expect(validateAttachmentFile(file('a.pdf', 'application/pdf', ATTACHMENT_MAX_BYTES))).toBeNull();
  });
});

describe('formato', () => {
  it('tamaños legibles', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2048)).toBe('2 KB');
    expect(formatFileSize(3.5 * 1024 * 1024)).toBe('3,5 MB');
  });

  it('el nombre para mostrar no lleva la extensión', () => {
    expect(displayNameWithoutExtension('Boleto aéreo CM385.pdf')).toBe('Boleto aéreo CM385');
    expect(displayNameWithoutExtension('foto.JPEG')).toBe('foto');
    expect(displayNameWithoutExtension('.pdf')).toBe('.pdf');
    expect(displayNameWithoutExtension('sin extension')).toBe('sin extension');
  });
});
