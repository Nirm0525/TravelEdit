export interface CountryCode {
  name: string;
  dialCode: string;
  flag: string;
}

// Lista práctica de códigos de país para el selector de teléfono — no son
// las 195 banderas de la ONU, pero cubre los mercados de origen realistas
// para leads de Travel Edit (Centroamérica primero, luego el resto del mundo
// en orden alfabético).
export const COUNTRY_CODES: CountryCode[] = [
  { name: 'Honduras', dialCode: '+504', flag: '🇭🇳' },
  { name: 'Guatemala', dialCode: '+502', flag: '🇬🇹' },
  { name: 'El Salvador', dialCode: '+503', flag: '🇸🇻' },
  { name: 'Nicaragua', dialCode: '+505', flag: '🇳🇮' },
  { name: 'Costa Rica', dialCode: '+506', flag: '🇨🇷' },
  { name: 'Panamá', dialCode: '+507', flag: '🇵🇦' },
  { name: 'Belice', dialCode: '+501', flag: '🇧🇿' },
  { name: 'México', dialCode: '+52', flag: '🇲🇽' },
  { name: 'Estados Unidos', dialCode: '+1', flag: '🇺🇸' },
  { name: 'Canadá', dialCode: '+1', flag: '🇨🇦' },
  { name: 'República Dominicana', dialCode: '+1', flag: '🇩🇴' },
  { name: 'Puerto Rico', dialCode: '+1', flag: '🇵🇷' },
  { name: 'Cuba', dialCode: '+53', flag: '🇨🇺' },
  { name: 'Jamaica', dialCode: '+1', flag: '🇯🇲' },
  { name: 'Colombia', dialCode: '+57', flag: '🇨🇴' },
  { name: 'Venezuela', dialCode: '+58', flag: '🇻🇪' },
  { name: 'Ecuador', dialCode: '+593', flag: '🇪🇨' },
  { name: 'Perú', dialCode: '+51', flag: '🇵🇪' },
  { name: 'Bolivia', dialCode: '+591', flag: '🇧🇴' },
  { name: 'Chile', dialCode: '+56', flag: '🇨🇱' },
  { name: 'Argentina', dialCode: '+54', flag: '🇦🇷' },
  { name: 'Uruguay', dialCode: '+598', flag: '🇺🇾' },
  { name: 'Paraguay', dialCode: '+595', flag: '🇵🇾' },
  { name: 'Brasil', dialCode: '+55', flag: '🇧🇷' },
  { name: 'España', dialCode: '+34', flag: '🇪🇸' },
  { name: 'Portugal', dialCode: '+351', flag: '🇵🇹' },
  { name: 'Reino Unido', dialCode: '+44', flag: '🇬🇧' },
  { name: 'Irlanda', dialCode: '+353', flag: '🇮🇪' },
  { name: 'Francia', dialCode: '+33', flag: '🇫🇷' },
  { name: 'Alemania', dialCode: '+49', flag: '🇩🇪' },
  { name: 'Italia', dialCode: '+39', flag: '🇮🇹' },
  { name: 'Países Bajos', dialCode: '+31', flag: '🇳🇱' },
  { name: 'Bélgica', dialCode: '+32', flag: '🇧🇪' },
  { name: 'Suiza', dialCode: '+41', flag: '🇨🇭' },
  { name: 'Austria', dialCode: '+43', flag: '🇦🇹' },
  { name: 'Suecia', dialCode: '+46', flag: '🇸🇪' },
  { name: 'Noruega', dialCode: '+47', flag: '🇳🇴' },
  { name: 'Dinamarca', dialCode: '+45', flag: '🇩🇰' },
  { name: 'Finlandia', dialCode: '+358', flag: '🇫🇮' },
  { name: 'Islandia', dialCode: '+354', flag: '🇮🇸' },
  { name: 'Polonia', dialCode: '+48', flag: '🇵🇱' },
  { name: 'Grecia', dialCode: '+30', flag: '🇬🇷' },
  { name: 'Turquía', dialCode: '+90', flag: '🇹🇷' },
  { name: 'Rusia', dialCode: '+7', flag: '🇷🇺' },
  { name: 'China', dialCode: '+86', flag: '🇨🇳' },
  { name: 'Japón', dialCode: '+81', flag: '🇯🇵' },
  { name: 'Corea del Sur', dialCode: '+82', flag: '🇰🇷' },
  { name: 'India', dialCode: '+91', flag: '🇮🇳' },
  { name: 'Emiratos Árabes Unidos', dialCode: '+971', flag: '🇦🇪' },
  { name: 'Arabia Saudita', dialCode: '+966', flag: '🇸🇦' },
  { name: 'Israel', dialCode: '+972', flag: '🇮🇱' },
  { name: 'Singapur', dialCode: '+65', flag: '🇸🇬' },
  { name: 'Tailandia', dialCode: '+66', flag: '🇹🇭' },
  { name: 'Indonesia', dialCode: '+62', flag: '🇮🇩' },
  { name: 'Filipinas', dialCode: '+63', flag: '🇵🇭' },
  { name: 'Vietnam', dialCode: '+84', flag: '🇻🇳' },
  { name: 'Sudáfrica', dialCode: '+27', flag: '🇿🇦' },
  { name: 'Egipto', dialCode: '+20', flag: '🇪🇬' },
  { name: 'Marruecos', dialCode: '+212', flag: '🇲🇦' },
  { name: 'Australia', dialCode: '+61', flag: '🇦🇺' },
  { name: 'Nueva Zelanda', dialCode: '+64', flag: '🇳🇿' }
];

export const DEFAULT_COUNTRY_DIAL_CODE = '+504';
