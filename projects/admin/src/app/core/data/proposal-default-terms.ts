/**
 * Términos y condiciones de partida para una propuesta nueva — un borrador
 * genérico y conservador que cada agencia debe revisar y ajustar (idealmente
 * con asesoría legal) antes de enviarlo. Todo lo que depende del negocio
 * (porcentajes, plazos, jurisdicción) queda entre [corchetes] para completar:
 * ninguna cifra ni política está inventada.
 */
export const DEFAULT_TERMS_TITLE = 'Términos y condiciones';

interface TermsSection {
  title: string;
  paragraphs: string[];
}

const INTRO = [
  'Estos Términos y Condiciones («T&C») regulan la venta por The Travel Edit («nosotros») de servicios y experiencias de viaje a medida, ya sea de forma individual o como parte de un itinerario.',
  'Léelos con atención. Al aceptar la propuesta declaras haberlos leído, entendido y aceptado en su totalidad.'
];

const SECTIONS: TermsSection[] = [
  {
    title: '1. Aceptación y celebración del contrato',
    paragraphs: [
      'La relación contractual se entiende celebrada cuando recibimos tu aceptación de la propuesta y de estos T&C.',
      'Nos reservamos el derecho de no proceder con una solicitud de reserva cuando no sea posible confirmar la disponibilidad de los servicios.'
    ]
  },
  {
    title: '2. Cotizaciones y disponibilidad',
    paragraphs: [
      'Los precios y la disponibilidad indicados en la propuesta son referenciales hasta que se confirme la reserva. Ningún servicio queda reservado hasta recibir el pago indicado en la sección de pagos.',
      'Si algún servicio dejara de estar disponible, tu asesora de viajes te propondrá alternativas equivalentes para mantener la calidad del itinerario.'
    ]
  },
  {
    title: '3. Pagos',
    paragraphs: [
      'Como regla general, para confirmar la reserva se requiere un depósito del [__]% del total al aceptar la propuesta, y el saldo restante [__] días antes del inicio del viaje.',
      'Es tu responsabilidad revisar todos los datos de la propuesta y realizar el pago dentro de los plazos indicados. Los cargos bancarios o de transferencia corren por tu cuenta.',
      'Los servicios no se consideran confirmados hasta que recibimos el monto solicitado en su totalidad.'
    ]
  },
  {
    title: '4. Cancelaciones por parte del cliente',
    paragraphs: [
      'Toda cancelación debe solicitarse por escrito. Las penalidades y los importes reembolsables dependen de las condiciones de cada proveedor y se te informarán al momento de la solicitud: [completar política de cancelación].',
      'Algunos servicios pueden no ser reembolsables una vez confirmados.'
    ]
  },
  {
    title: '5. Cancelación o cambios por parte nuestra',
    paragraphs: [
      'Si por causas ajenas a tu voluntad debemos cancelar o modificar un servicio, te ofreceremos una alternativa de calidad equivalente o el reembolso del importe pagado por ese servicio.'
    ]
  },
  {
    title: '6. Cambios en las reservas',
    paragraphs: [
      'Los cambios solicitados después de la confirmación están sujetos a disponibilidad y pueden generar cargos de los proveedores y gastos de gestión: [completar].'
    ]
  },
  {
    title: '7. Temporada alta y eventos',
    paragraphs: [
      'En temporada alta o durante eventos de alta demanda pueden aplicarse condiciones y tarifas especiales, y algunos servicios requerir garantías o pagos anticipados adicionales.'
    ]
  },
  {
    title: '8. Responsabilidad',
    paragraphs: [
      'Actuamos como organizadores e intermediarios de servicios prestados por proveedores terceros (hoteles, transportistas, guías, restaurantes y otros). No somos responsables por hechos fuera de nuestro control razonable, como fuerza mayor, huelgas, condiciones climáticas o decisiones de autoridades.',
      'Salvo lo que establezca la ley aplicable, nuestra responsabilidad se limita al importe pagado por el servicio afectado.'
    ]
  },
  {
    title: '9. Seguro de viaje',
    paragraphs: [
      'Recomendamos contratar un seguro de viaje que cubra cancelación, asistencia médica y equipaje antes de iniciar el viaje.'
    ]
  },
  {
    title: '10. Documentación de viaje',
    paragraphs: [
      'Es responsabilidad de cada viajero contar con pasaporte vigente, visas, vacunas y cualquier documento exigido por los países de destino y de tránsito.'
    ]
  },
  {
    title: '11. Protección de datos personales',
    paragraphs: [
      'Usamos tus datos personales únicamente para gestionar tu viaje, y compartimos con los proveedores solo la información necesaria para prestar cada servicio.'
    ]
  },
  {
    title: '12. Ley aplicable y jurisdicción',
    paragraphs: ['Estos T&C se rigen por las leyes de [país o jurisdicción] y cualquier disputa se someterá a [tribunales o ciudad].']
  },
  {
    title: '13. Disposiciones generales',
    paragraphs: [
      'Si alguna disposición de estos T&C fuera inválida o inaplicable, el resto seguirá siendo plenamente válido. Las modificaciones solo serán válidas si constan por escrito.'
    ]
  }
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export const DEFAULT_TERMS_HTML: string = [
  ...INTRO.map((text) => `<p>${escapeHtml(text)}</p>`),
  ...SECTIONS.flatMap((section) => [
    `<h2>${escapeHtml(section.title)}</h2>`,
    ...section.paragraphs.map((text) => `<p>${escapeHtml(text)}</p>`)
  ])
].join('');

/** true si el texto todavía tiene campos [entre corchetes] sin completar. */
export function termsHasPlaceholders(html: string): boolean {
  return /\[[^\]]*\]/.test(html.replace(/<[^>]*>/g, ''));
}
