import { DestinationStatus, Season, TripType } from '../models/destination-enums';

export const TRIP_TYPE_OPTIONS: ReadonlyArray<{ value: TripType; label: string }> = [
  { value: 'safari', label: 'Safari' },
  { value: 'islas', label: 'Islas' },
  { value: 'ciudad', label: 'Ciudad' },
  { value: 'ruta_cultural', label: 'Ruta cultural' },
  { value: 'aventura', label: 'Aventura' },
  { value: 'bienestar', label: 'Bienestar' },
  { value: 'otro', label: 'Otro' }
];

export const SEASON_OPTIONS: ReadonlyArray<{ value: Season; label: string }> = [
  { value: 'todo_el_año', label: 'Todo el año' },
  { value: 'primavera', label: 'Primavera' },
  { value: 'verano', label: 'Verano' },
  { value: 'otoño', label: 'Otoño' },
  { value: 'invierno', label: 'Invierno' }
];

export const DESTINATION_STATUS_LABEL: Record<DestinationStatus, string> = {
  draft: 'Borrador',
  published: 'Publicado',
  archived: 'Archivado'
};
