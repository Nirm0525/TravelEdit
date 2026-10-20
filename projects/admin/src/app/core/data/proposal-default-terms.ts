/**
 * Términos y condiciones de partida de una propuesta nueva (y lo que carga el botón «Cargar términos de partida»).
 *
 * Es el texto general de Travel Edit, tal como lo redactó la agencia: las condiciones de pago, cancelación y modificación NO son
 * únicas, dependen de cada proveedor y se comunican por reserva (sección «Condiciones particulares de cada reserva»). La razón
 * social queda entre [corchetes] y el constructor avisa mientras siga sin completar.
 *
 * Las secciones se numeran solas (orden del arreglo), así agregar o mover una no obliga a renumerar a mano.
 */
export const DEFAULT_TERMS_TITLE = 'Términos y condiciones';

type Block = { p: string } | { ul: string[] };

interface TermsSection {
  title: string;
  blocks: Block[];
}

const p = (text: string): Block => ({ p: text });
const ul = (...items: string[]): Block => ({ ul: items });

const HEADING = 'Experiencias de viaje personalizadas';

const INTRO: Block[] = [
  p(
    'Los presentes Términos y Condiciones («T&C») regulan la contratación de servicios de asesoría, planificación, organización y reserva de experiencias de viaje ofrecidas bajo la marca comercial Travel Edit, operada por [razón social legal], en adelante denominada «Travel Edit».'
  ),
  p(
    'Al aceptar una propuesta de viaje, el cliente reconoce haber recibido, leído y comprendido los presentes Términos y Condiciones, así como las condiciones particulares de los servicios contratados.'
  ),
  p('Estos términos se complementan con las políticas de los proveedores correspondientes y con las disposiciones legales aplicables.')
];

const SECTIONS: TermsSection[] = [
  {
    title: 'Aceptación y contratación',
    blocks: [
      p(
        'La relación contractual se formalizará mediante la aceptación expresa de la propuesta y de los presentes Términos y Condiciones, conforme a los requisitos legales aplicables.'
      ),
      p('La aceptación de una cotización no garantiza por sí sola la disponibilidad de los servicios.'),
      p(
        'Las reservas estarán sujetas a la confirmación definitiva de los proveedores y al cumplimiento de las condiciones de pago correspondientes.'
      )
    ]
  },
  {
    title: 'Cotizaciones, tarifas y disponibilidad',
    blocks: [
      p(
        'Todas las cotizaciones están sujetas a disponibilidad y posibles modificaciones de tarifas hasta el momento de la confirmación.'
      ),
      p(
        'Los precios podrán variar debido a cambios en tarifas de proveedores, fluctuaciones cambiarias, impuestos, tasas gubernamentales u otros cargos aplicables.'
      ),
      p('Travel Edit no garantiza el mantenimiento de una tarifa cuando el cliente no confirme o efectúe los pagos dentro de los plazos establecidos.'),
      p(
        'En caso de que un servicio deje de estar disponible antes de su confirmación, Travel Edit podrá proponer alternativas sujetas a la aprobación del cliente.'
      ),
      p('Cualquier modificación posterior a la contratación se gestionará conforme a las condiciones aceptadas y la legislación aplicable.')
    ]
  },
  {
    title: 'Políticas de pago',
    blocks: [
      p(
        'Las condiciones de pago serán determinadas individualmente para cada reserva, de acuerdo con los requisitos establecidos por los proveedores involucrados.'
      ),
      p('Dependiendo de los servicios contratados, podrá requerirse:'),
      ul(
        'Pago total al momento de confirmar.',
        'Depósito inicial para garantizar determinados servicios.',
        'Pagos parciales o escalonados.',
        'Liquidación del saldo en una fecha específica antes del viaje.',
        'Pagos anticipados adicionales para servicios especiales, reservas privadas o temporadas de alta demanda.'
      ),
      p('Travel Edit comunicará al cliente los montos, porcentajes y fechas límite aplicables antes de formalizar la contratación.'),
      p('No existe un porcentaje de depósito ni un plazo de pago universal para todos los viajes.'),
      p('El cliente es responsable de realizar los pagos dentro de los plazos establecidos.'),
      p(
        'El incumplimiento de dichos plazos podrá ocasionar la cancelación de servicios, pérdida de disponibilidad o aplicación de penalidades, conforme a las condiciones previamente informadas y aceptadas.'
      ),
      p('Los cargos bancarios, comisiones por transferencia y diferencias cambiarias serán comunicados y aplicados según corresponda.')
    ]
  },
  {
    title: 'Políticas de cancelación',
    blocks: [
      p(
        'Las políticas de cancelación son específicas de cada reserva y dependen de las condiciones establecidas por los proveedores de los servicios contratados.'
      ),
      p('Por lo tanto, no existe una política única de cancelación aplicable a todos los itinerarios de Travel Edit.'),
      p('Cada servicio podrá contar con condiciones diferentes, incluyendo:'),
      ul(
        'Cancelación gratuita hasta una fecha determinada.',
        'Penalidades parciales según la anticipación de la cancelación.',
        'Pérdida del depósito inicial.',
        'Penalidad equivalente al 100 % del servicio.',
        'Servicios no reembolsables desde su confirmación.'
      ),
      p('Las condiciones particulares de cancelación serán comunicadas al cliente antes de confirmar los servicios.'),
      p('Toda solicitud de cancelación deberá realizarse por escrito.'),
      p('Cuando una reserva incluya varios servicios, cada uno podrá estar sujeto a su propia política de cancelación.'),
      p('Travel Edit gestionará las solicitudes conforme a las condiciones contractuales aceptadas y a los derechos que correspondan al cliente por ley.')
    ]
  },
  {
    title: 'Depósitos y servicios no reembolsables',
    blocks: [
      p('Algunos proveedores requieren depósitos no reembolsables para confirmar sus servicios.'),
      p(
        'Entre ellos pueden encontrarse hoteles con tarifas especiales, villas privadas, cruceros, boletos aéreos, entradas a atracciones, experiencias exclusivas y transportes privados.'
      ),
      p('Cuando un depósito o pago sea no reembolsable, esta condición será informada expresamente antes de su aceptación.'),
      p(
        'El carácter no reembolsable de un servicio no elimina los derechos de reembolso que pudieran corresponder al cliente por incumplimiento, cancelación del proveedor u otras causas reconocidas por la legislación aplicable.'
      )
    ]
  },
  {
    title: 'Reembolsos',
    blocks: [
      p('Los reembolsos estarán sujetos a las condiciones particulares de los servicios contratados y a las disposiciones legales aplicables.'),
      p('Cuando un reembolso deba ser procesado por un proveedor externo, Travel Edit gestionará la solicitud y dará seguimiento a su resolución.'),
      p('Los tiempos de devolución dependerán del proveedor, la entidad financiera y el método de pago.'),
      p('Travel Edit informará al cliente sobre el estado de su solicitud y los importes autorizados para devolución.'),
      p(
        'Los honorarios profesionales y gastos de gestión efectivamente prestados podrán tener condiciones independientes, siempre que hayan sido informadas y aceptadas previamente y que su retención sea legalmente procedente.'
      )
    ]
  },
  {
    title: 'Modificaciones de reservas',
    blocks: [
      p('Cualquier cambio solicitado después de la confirmación estará sujeto a disponibilidad y a las condiciones del proveedor correspondiente.'),
      p('Las modificaciones pueden incluir cambios de fechas, destinos, nombres, hoteles, habitaciones, vuelos, actividades o número de participantes.'),
      p('Los cambios podrán generar diferencias tarifarias, penalidades de proveedores y gastos adicionales de gestión previamente informados.'),
      p('Algunos servicios no permiten modificaciones después de su confirmación.')
    ]
  },
  {
    title: 'Honorarios profesionales y gastos de gestión',
    blocks: [
      p('Travel Edit podrá cobrar honorarios por asesoría, diseño de itinerarios, planificación, coordinación y gestión de servicios de viaje.'),
      p('Estos honorarios serán comunicados al cliente antes de la contratación y podrán ser independientes de los importes cobrados por los proveedores.'),
      p(
        'En caso de cancelación, los honorarios correspondientes a servicios efectivamente prestados podrán ser no reembolsables, siempre que dicha condición haya sido aceptada y resulte válida conforme a la legislación aplicable.'
      )
    ]
  },
  {
    title: 'Transporte aéreo',
    blocks: [
      p('Los boletos aéreos están sujetos a las condiciones tarifarias, operativas y contractuales de cada aerolínea.'),
      p(
        'Las políticas de cambios, cancelaciones, reembolsos, equipaje, selección de asientos y horarios serán las establecidas por la aerolínea correspondiente, sin perjuicio de los derechos legales del pasajero.'
      ),
      p('Las aerolíneas podrán modificar itinerarios, horarios o rutas por razones operativas.'),
      p('Travel Edit brindará asistencia razonable en la gestión de incidencias y alternativas disponibles.'),
      p('Los pasajeros son responsables de cumplir los requisitos de documentación, horarios de presentación y condiciones de transporte.')
    ]
  },
  {
    title: 'Hoteles y alojamientos',
    blocks: [
      p('Las reservas de alojamiento están sujetas a las políticas de cada establecimiento.'),
      p(
        'Los horarios de check-in y check-out, depósitos por incidentales, impuestos locales, cargos de destino y demás condiciones serán determinados por el hotel.'
      ),
      p(
        'Las solicitudes especiales, incluyendo habitaciones comunicadas, ubicación, tipo de cama, early check-in, late check-out, upgrades y amenidades, estarán sujetas a confirmación expresa del establecimiento.'
      ),
      p('Travel Edit no garantiza beneficios que el proveedor no haya confirmado.'),
      p('Las características esenciales contratadas y pagadas deberán respetarse conforme a las obligaciones contractuales aplicables.')
    ]
  },
  {
    title: 'Cruceros',
    blocks: [
      p('Las reservas de cruceros estarán sujetas a las condiciones particulares de cada naviera.'),
      p('Las políticas de depósitos, pagos finales, cancelaciones, cambios de nombres e itinerarios podrán variar según la naviera, tarifa y fecha de salida.'),
      p('Las escalas, horarios y puertos podrán modificarse por razones operativas, climáticas o de seguridad.'),
      p(
        'Los pasajeros deberán cumplir los requisitos migratorios correspondientes a todos los países incluidos en el itinerario, incluso cuando se trate de escalas breves.'
      )
    ]
  },
  {
    title: 'Excursiones, actividades y transporte terrestre',
    blocks: [
      p('Las excursiones, guías privados, traslados y actividades están sujetos a las condiciones de sus respectivos operadores.'),
      p('Los horarios, rutas y actividades podrán ajustarse por circunstancias operativas, climáticas, restricciones locales o razones de seguridad.'),
      p('El cliente deberá cumplir los horarios y puntos de encuentro confirmados.'),
      p(
        'La falta de presentación o llegada tardía podrá ocasionar la pérdida del servicio, de acuerdo con las condiciones del proveedor y la legislación aplicable.'
      ),
      p('Los servicios privados estarán limitados a la duración, recorrido y características expresamente contratadas.')
    ]
  },
  {
    title: 'Documentación de viaje y responsabilidad migratoria del cliente',
    blocks: [
      p(
        'Es responsabilidad exclusiva de cada viajero conocer, verificar y cumplir con todos los requisitos migratorios, sanitarios y de documentación necesarios para realizar su viaje, tanto en los países de destino como en los países de tránsito, conexiones y escalas, independientemente de la duración de su estancia.'
      ),
      p('Esto incluye, entre otros:'),
      ul(
        'Vigencia y condiciones del pasaporte.',
        'Visas de turismo, tránsito o cualquier otra categoría requerida.',
        'Permisos de entrada, autorizaciones electrónicas y requisitos migratorios especiales.',
        'Certificados de vacunación y requisitos sanitarios.',
        'Permisos de salida y autorizaciones de viaje para menores de edad.',
        'Requisitos específicos según nacionalidad, residencia, itinerario y tipo de pasaporte.',
        'Cualquier otra documentación exigida por las autoridades migratorias, aerolíneas, navieras u organismos correspondientes.'
      ),
      p(
        'El cliente reconoce que es su responsabilidad investigar y confirmar estos requisitos directamente con las embajadas, consulados, autoridades migratorias y demás organismos oficiales competentes, con suficiente anticipación a su fecha de viaje.'
      ),
      p(
        'Travel Edit podrá proporcionar información u orientación general como servicio complementario; sin embargo, dicha orientación no sustituye la verificación personal que corresponde realizar al viajero ni constituye garantía de aprobación de visas, autorización de embarque o admisión a un país.'
      ),
      p(
        'Travel Edit no será responsable por pérdidas económicas, gastos adicionales, denegaciones de embarque, rechazos migratorios o imposibilidad de realizar el viaje derivados del incumplimiento de requisitos documentales o migratorios atribuible al cliente, sin perjuicio de las responsabilidades que legalmente correspondan a Travel Edit por errores u omisiones propios.'
      ),
      p(
        'En caso de que un pasajero no pueda viajar por falta de documentación válida o incumplimiento de requisitos migratorios, se aplicarán las políticas de cancelación y reembolso de los proveedores correspondientes, conforme a las condiciones previamente aceptadas y a la legislación aplicable.'
      ),
      p(
        'La contratación y confirmación de un viaje con Travel Edit no implica que los requisitos migratorios del pasajero hayan sido verificados, aprobados o garantizados por nuestra empresa.'
      )
    ]
  },
  {
    title: 'Salud y necesidades especiales',
    blocks: [
      p('El cliente deberá comunicar oportunamente cualquier necesidad especial que requiera coordinación con los proveedores.'),
      p('Esto puede incluir accesibilidad, movilidad reducida, restricciones alimentarias, conservación de medicamentos o asistencia particular.'),
      p(
        'Travel Edit realizará las gestiones correspondientes, pero la disponibilidad de instalaciones o servicios especiales dependerá de la confirmación del proveedor.'
      ),
      p('Los datos médicos se solicitarán únicamente cuando sean necesarios y se tratarán conforme a las obligaciones de privacidad aplicables.')
    ]
  },
  {
    title: 'Seguro de viaje',
    blocks: [
      p('Travel Edit recomienda contratar un seguro de viaje adecuado a las características del itinerario.'),
      p('Se recomienda incluir asistencia médica, cancelación, interrupción de viaje, pérdida de equipaje y otras coberturas pertinentes.'),
      p('Las condiciones, límites y exclusiones dependerán de la póliza contratada.'),
      p('La contratación de un seguro no garantiza que todas las causas de cancelación estén cubiertas.')
    ]
  },
  {
    title: 'Viajes con menores de edad',
    blocks: [
      p('Los padres o responsables deberán asegurarse de que los menores cuenten con la documentación y autorizaciones correspondientes.'),
      p('Las condiciones de alojamiento, transporte, actividades y acompañamiento de menores estarán sujetas a las políticas de los proveedores.')
    ]
  },
  {
    title: 'Viajes grupales y familiares',
    blocks: [
      p('Las reservas grupales podrán estar sujetas a políticas especiales de depósitos, fechas límite, bloqueos de habitaciones y penalidades.'),
      p('La reducción de participantes podrá ocasionar modificaciones en las tarifas o en los costos de servicios compartidos.'),
      p('Los cambios de integrantes estarán sujetos a las condiciones de cada proveedor.'),
      p('Las condiciones particulares de cada grupo serán comunicadas antes de la contratación.')
    ]
  },
  {
    title: 'Experiencias especiales y celebraciones',
    blocks: [
      p(
        'Las solicitudes relacionadas con lunas de miel, aniversarios, cumpleaños, celebraciones, amenidades, upgrades y beneficios VIP estarán sujetas a disponibilidad y confirmación del proveedor.'
      ),
      p('Los beneficios de cortesía no confirmados expresamente no constituyen servicios garantizados.'),
      p('Los servicios especiales contratados y pagados deberán prestarse conforme a lo acordado y a los derechos legales del cliente.')
    ]
  },
  {
    title: 'Circunstancias extraordinarias y fuerza mayor',
    blocks: [
      p(
        'Los servicios podrán verse afectados por circunstancias fuera del control razonable de las partes, incluyendo desastres naturales, condiciones climáticas extremas, conflictos, huelgas, emergencias sanitarias, cierres de aeropuertos o restricciones gubernamentales.'
      ),
      p('En tales circunstancias, Travel Edit brindará asistencia razonable y gestionará las alternativas disponibles.'),
      p('Las modificaciones, créditos, reembolsos y responsabilidades se determinarán conforme a las condiciones contractuales válidas y la legislación aplicable.')
    ]
  },
  {
    title: 'Responsabilidad',
    blocks: [
      p('Travel Edit actúa, según el servicio contratado, como asesor, organizador, intermediario o prestador directo de servicios turísticos.'),
      p('Los servicios pueden ser ejecutados por proveedores independientes, incluyendo aerolíneas, hoteles, navieras, transportistas, guías y operadores locales.'),
      p('Travel Edit responderá por sus propias obligaciones contractuales y legales, incluyendo los errores u omisiones que le sean atribuibles.'),
      p('La responsabilidad por actos de terceros se determinará según la naturaleza de la contratación y la legislación aplicable.'),
      p('Travel Edit no garantiza la ausencia de circunstancias externas que puedan afectar el desarrollo del viaje.'),
      p('Ninguna disposición de estos términos pretende excluir responsabilidades legalmente irrenunciables ni limitar los derechos de protección al consumidor.')
    ]
  },
  {
    title: 'No-show y servicios no utilizados',
    blocks: [
      p('La falta de presentación del pasajero en un servicio confirmado podrá considerarse no-show.'),
      p('Las consecuencias económicas dependerán de las condiciones específicas del proveedor y de las disposiciones legales aplicables.'),
      p(
        'Los servicios voluntariamente no utilizados durante el viaje no generarán automáticamente derecho a reembolso, salvo que las condiciones contratadas o la legislación aplicable establezcan lo contrario.'
      )
    ]
  },
  {
    title: 'Conducta y cumplimiento de normas',
    blocks: [
      p('Los viajeros deberán respetar las normas de seguridad y convivencia establecidas por los proveedores.'),
      p(
        'Las conductas que ocasionen daños, sanciones o exclusión de servicios podrán generar consecuencias económicas para el responsable, conforme a las condiciones contractuales y legales aplicables.'
      )
    ]
  },
  {
    title: 'Objetos personales y equipaje',
    blocks: [
      p('Los pasajeros deberán cumplir las políticas de equipaje y seguridad de cada proveedor.'),
      p('En caso de pérdida, robo o daño, Travel Edit podrá brindar asistencia para gestionar la reclamación correspondiente.'),
      p('Las responsabilidades se determinarán conforme a las condiciones contractuales y la normativa aplicable.')
    ]
  },
  {
    title: 'Protección de datos personales',
    blocks: [
      p('Travel Edit utilizará la información personal proporcionada por los clientes para gestionar cotizaciones, reservas, pagos y coordinación de servicios.'),
      p('Los datos necesarios podrán compartirse con los proveedores involucrados en la prestación del viaje.'),
      p('Travel Edit adoptará medidas razonables de protección de la información y cumplirá las obligaciones legales aplicables en materia de privacidad.')
    ]
  },
  {
    title: 'Comunicaciones y confirmaciones',
    blocks: [
      p('Las solicitudes de cambios, cancelaciones y autorizaciones deberán realizarse por escrito a través de los canales oficiales de Travel Edit.'),
      p('Las comunicaciones electrónicas podrán utilizarse como constancia de las instrucciones y acuerdos, conforme a la legislación aplicable.'),
      p('Las modificaciones que impliquen costos adicionales deberán comunicarse al cliente para su aprobación cuando corresponda.')
    ]
  },
  {
    title: 'Reclamaciones y asistencia durante el viaje',
    blocks: [
      p('Cualquier incidencia deberá comunicarse a Travel Edit y, cuando corresponda, al proveedor involucrado tan pronto como resulte razonablemente posible.'),
      p('Travel Edit colaborará en la gestión de reclamaciones y en la búsqueda de soluciones conforme al alcance de los servicios contratados.'),
      p('La presentación de reclamaciones ante Travel Edit no limita los derechos del cliente de acudir a las autoridades competentes.')
    ]
  },
  {
    title: 'Condiciones particulares de cada reserva',
    blocks: [
      p('Cada propuesta de Travel Edit incluirá o identificará las condiciones particulares de pago, cancelación y modificación correspondientes a los servicios contratados.'),
      p('Estas condiciones podrán variar según el proveedor, destino, temporada, tarifa, categoría de servicio y fecha de viaje.'),
      p('El cliente deberá conocerlas y aceptarlas antes de formalizar la contratación.'),
      p(
        'Cuando existan diferencias entre las condiciones generales y las particulares, prevalecerán las disposiciones legales obligatorias y las condiciones específicas válidamente aceptadas para cada servicio.'
      ),
      p('Travel Edit no aplicará penalidades, gastos o restricciones que no hayan sido debidamente informados cuando su comunicación previa sea legalmente exigible.')
    ]
  },
  {
    title: 'Legislación aplicable y resolución de controversias',
    blocks: [
      p(
        'La contratación estará sujeta a la legislación aplicable según la entidad contratante, la naturaleza del servicio y las disposiciones de protección al consumidor correspondientes.'
      ),
      p('Las partes procurarán resolver cualquier diferencia mediante comunicación directa.'),
      p('Lo anterior no limita el derecho del cliente de acudir a las autoridades administrativas o judiciales competentes.')
    ]
  },
  {
    title: 'Disposiciones generales',
    blocks: [
      p(
        'Si alguna disposición de estos Términos y Condiciones fuera declarada inválida o inaplicable, las demás continuarán vigentes en la medida legalmente permitida.'
      ),
      p('Cualquier modificación contractual deberá formalizarse mediante un mecanismo válido y con las autorizaciones que correspondan.')
    ]
  },
  {
    title: 'Aceptación de términos y condiciones',
    blocks: [
      p('Al formalizar la contratación, el cliente reconoce haber recibido información sobre:'),
      ul(
        'Los servicios incluidos y excluidos.',
        'El precio total y los conceptos de pago.',
        'Los depósitos y fechas límite aplicables.',
        'Las políticas particulares de cancelación y modificación.',
        'Los servicios no reembolsables, cuando corresponda.',
        'Su responsabilidad de verificar y cumplir los requisitos migratorios.',
        'Los presentes Términos y Condiciones Generales.'
      )
    ]
  }
];

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function renderBlock(block: Block): string {
  return 'p' in block ? `<p>${escapeHtml(block.p)}</p>` : `<ul>${block.ul.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export const DEFAULT_TERMS_HTML: string = [
  `<p><em>${escapeHtml(HEADING)}</em></p>`,
  ...INTRO.map(renderBlock),
  ...SECTIONS.flatMap((section, index) => [`<h2>${index + 1}. ${escapeHtml(section.title)}</h2>`, ...section.blocks.map(renderBlock)])
].join('');

/** Cantidad de secciones numeradas (para pruebas y para no desincronizar referencias). */
export const DEFAULT_TERMS_SECTION_COUNT = SECTIONS.length;

/** true si el texto todavía tiene campos [entre corchetes] sin completar. */
export function termsHasPlaceholders(html: string): boolean {
  return /\[[^\]]*\]/.test(html.replace(/<[^>]*>/g, ''));
}
