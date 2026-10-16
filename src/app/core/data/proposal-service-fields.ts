// Espejo de projects/admin/src/app/core/data/proposal-service-fields.ts — apps separadas que no
// comparten código; cualquier cambio de campos debe replicarse en ambos lados.
import { ProposalServiceType } from '../models/proposal-content.model';

export interface ProposalServiceFieldDef {
  /** Clave dentro de service.details — salvo 'time', que vive en service.time
   *  (el campo "Hora" de la fila superior de cada servicio). */
  key: string;
  label: string;
  placeholder: string;
}

/**
 * Ficha de datos de cada tipo de servicio — lo que el cliente ve como tabla
 * debajo de la foto (ver la propuesta pública). El orden de cada lista es el
 * orden de la tabla. Los campos vacíos no se muestran: nunca se inventa un
 * dato que el agente no cargó.
 */
export const PROPOSAL_SERVICE_FIELDS: Record<ProposalServiceType, ProposalServiceFieldDef[]> = {
  transfer: [
    { key: 'transferType', label: 'Tipo de traslado', placeholder: 'Ej. Mini Bus 22 pax' },
    { key: 'passengers', label: 'Pasajeros', placeholder: 'Ej. 8' },
    { key: 'baggage', label: 'Equipaje', placeholder: 'Ej. 4 maletas' },
    { key: 'time', label: 'Hora de recogida', placeholder: '' },
    { key: 'travelDistance', label: 'Distancia del viaje (km)', placeholder: 'Ej. 15' },
    { key: 'pickupLocation', label: 'Lugar de recogida', placeholder: 'Nombre y dirección' },
    { key: 'dropoffLocation', label: 'Lugar de destino', placeholder: 'Nombre y dirección' },
    { key: 'distance', label: 'Distancia', placeholder: 'Ej. 15.3 km' },
    { key: 'flightTrain', label: 'Vuelo / Tren', placeholder: 'Ej. IB579 · salida 16:00' },
    { key: 'passengerCapacity', label: 'Capacidad de pasajeros', placeholder: 'Ej. 27 personas' },
    { key: 'luggageCapacity', label: 'Capacidad de equipaje', placeholder: 'Ej. 24 maletas' }
  ],
  flight: [
    { key: 'airline', label: 'Aerolínea', placeholder: 'Ej. Iberia' },
    { key: 'flightNumber', label: 'Número de vuelo', placeholder: 'Ej. IB579' },
    { key: 'origin', label: 'Origen', placeholder: 'Ej. Florencia (FLR)' },
    { key: 'destination', label: 'Destino', placeholder: 'Ej. Madrid (MAD)' },
    { key: 'time', label: 'Hora de salida', placeholder: '' },
    { key: 'arrivalTime', label: 'Hora de llegada', placeholder: 'Ej. 18:40' },
    { key: 'cabin', label: 'Clase', placeholder: 'Ej. Económica' },
    { key: 'baggage', label: 'Equipaje', placeholder: 'Ej. 1 maleta de 23 kg' }
  ],
  hotel: [
    { key: 'category', label: 'Categoría', placeholder: 'Ej. 5 estrellas' },
    { key: 'roomType', label: 'Tipo de habitación', placeholder: 'Ej. Suite con vista al mar' },
    { key: 'checkIn', label: 'Check-in', placeholder: 'Ej. 15:00' },
    { key: 'checkOut', label: 'Check-out', placeholder: 'Ej. 12:00' },
    { key: 'guests', label: 'Huéspedes', placeholder: 'Ej. 2 adultos' },
    { key: 'mealPlan', label: 'Régimen de comidas', placeholder: 'Ej. Desayuno incluido' },
    { key: 'address', label: 'Dirección', placeholder: 'Dirección del hotel' }
  ],
  activity: [
    { key: 'time', label: 'Hora de inicio', placeholder: '' },
    { key: 'duration', label: 'Duración', placeholder: 'Ej. 3 horas' },
    { key: 'meetingPoint', label: 'Punto de encuentro', placeholder: 'Nombre y dirección' },
    { key: 'participants', label: 'Participantes', placeholder: 'Ej. 4 personas' },
    { key: 'included', label: 'Incluye', placeholder: 'Ej. Guía privado, degustación' },
    { key: 'language', label: 'Idioma / guía', placeholder: 'Ej. Español' }
  ],
  other: [
    { key: 'time', label: 'Hora', placeholder: '' },
    { key: 'location', label: 'Ubicación', placeholder: 'Nombre y dirección' },
    { key: 'details', label: 'Detalles', placeholder: 'Información adicional' }
  ]
};

/** Filas listas para mostrar: solo campos con valor, en el orden de la ficha. */
export function serviceDetailRows(service: {
  type: ProposalServiceType;
  time: string;
  details?: Record<string, string>;
}): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  for (const field of PROPOSAL_SERVICE_FIELDS[service.type] ?? []) {
    const value = (field.key === 'time' ? service.time : service.details?.[field.key])?.trim();
    if (value) {
      rows.push({ label: field.label, value });
    }
  }
  return rows;
}
