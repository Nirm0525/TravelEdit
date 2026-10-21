// Correo de un ITINERARIO compartido. Texto propio: nada de «propuesta», precios, inversión, condiciones ni aceptación. Recibe solo
// lo que el correo necesita (nombre, enlace y si el acceso lleva código): nunca la fila completa, así que no hay forma de que un
// dato comercial llegue a la plantilla.
import { emailShellHtml, escapeHtml, type EmailContent } from '../_shared/email-brand.ts';

export interface ItineraryEmailInput {
  clientName: string;
  privateUrl: string;
  accessRequired: boolean;
}

export function buildItineraryEmail(input: ItineraryEmailInput): EmailContent {
  const { clientName, privateUrl, accessRequired } = input;
  const safeName = escapeHtml(clientName.split(' ')[0] || clientName);
  const safeUrl = escapeHtml(privateUrl);
  // El código NUNCA viaja en este correo: el enlace y el código son dos canales separados a propósito.
  const accessNote = accessRequired
    ? 'Por tu seguridad, necesitarás un código de acceso para abrirlo. Te lo compartiremos por otro canal.'
    : '';

  const sections = [
    ['01', 'RECORRIDO', 'Tu viaje, día a día'],
    ['02', 'SERVICIOS', 'Alojamientos, traslados y experiencias'],
    ['03', 'CONSEJOS', 'Recomendaciones para tu viaje']
  ];

  const bodyRows = `
    <tr>
      <td style="background:#6D2A34; padding:32px 28px 34px; border-radius:2px;">
        <p style="margin:0 0 10px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:2px; color:#CAAE97;">&mdash; TU ITINERARIO DE VIAJE</p>
        <p style="margin:0 0 14px; font-family:Georgia,'Times New Roman',serif; font-size:30px; line-height:1.2; color:#F6EFE6;">Hola ${safeName},<br /><em>tu itinerario está listo.</em></p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:1.6; color:#F6EFE6;">Reunimos en un solo lugar el recorrido de tu viaje, con el detalle de cada servicio.</p>
      </td>
    </tr>

    <tr>
      <td style="padding:28px 28px 0;">
        <p style="margin:0 0 12px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:2px; color:#16110F;">EN TU ITINERARIO ENCONTRARÁS</p>
        <div style="border-top:1px solid #C79A5B;"></div>
      </td>
    </tr>

    <tr>
      <td style="padding:0 28px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${sections
              .map(
                ([n, label, desc], i) => `
            <td width="33%" valign="top" style="padding:16px ${i === 2 ? '0' : '12px'} 16px ${i === 0 ? '0' : '12px'};${i < 2 ? ' border-right:1px solid #E3D3C0;' : ''}">
              <p style="margin:0 0 4px; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:16px; color:#CAAE97;">${n}</p>
              <p style="margin:0 0 4px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:1px; color:#7A2338;">${label}</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.5; color:#8A7F76;">${desc}</p>
            </td>`
              )
              .join('')}
          </tr>
        </table>
        <div style="border-top:1px solid #E3D3C0;"></div>
      </td>
    </tr>

    <tr>
      <td align="center" style="padding:28px 28px 8px;">
        <a href="${safeUrl}" style="display:inline-block; background:#6D2A34; color:#F6EFE6; text-decoration:none; font-family:Arial,Helvetica,sans-serif; font-size:11px; font-weight:bold; letter-spacing:2px; padding:14px 32px;">VER MI ITINERARIO</a>
        <p style="margin:10px 0 0; font-family:Arial,Helvetica,sans-serif; font-size:10px; color:#8A7F76;">Disponible en línea desde cualquier dispositivo.</p>
      </td>
    </tr>

    ${
      accessNote
        ? `<tr>
      <td style="padding:20px 28px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#E9DFD3; border-radius:2px;">
          <tr>
            <td width="44" valign="middle" style="padding:16px 0 16px 16px;">
              <div style="width:30px; height:30px; line-height:30px; border:1px solid #CAAE97; border-radius:15px; text-align:center; font-size:13px; background:#F6EFE6;">&#128274;</div>
            </td>
            <td valign="middle" style="padding:16px 16px 16px 12px;">
              <p style="margin:0 0 3px; font-family:Arial,Helvetica,sans-serif; font-size:10px; font-weight:bold; letter-spacing:2px; color:#6D2A34;">ACCESO PROTEGIDO</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.5; color:#16110F;">${accessNote}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`
        : ''
    }

    <tr>
      <td align="center" style="padding:28px 28px 32px;">
        <p style="margin:0 0 6px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:1.6; color:#8A7F76;">¿Tienes alguna duda? Responde a este correo y tu asesora te ayudará.</p>
        <p style="margin:0; font-family:Georgia,'Times New Roman',serif; font-style:italic; font-size:16px; color:#6D2A34;">Con cariño, el equipo de The Travel Edit.</p>
      </td>
    </tr>`;

  const html = emailShellHtml(bodyRows, 'Recibes este correo porque viajas con The Travel Edit.');
  const text = [
    `Hola ${clientName}, tu itinerario de viaje está listo.`,
    '',
    'Ver mi itinerario:',
    privateUrl,
    ...(accessNote ? ['', accessNote] : []),
    '',
    'The Travel Edit'
  ].join('\n');

  return { subject: 'Tu itinerario de viaje está listo', html, text };
}
