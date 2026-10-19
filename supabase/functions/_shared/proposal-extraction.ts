// Schema de extracción de un viaje desde un PDF — única fuente de verdad.
//
// De este archivo salen: (1) la validación con zod de lo que devuelve el modelo,
// (2) el `input_schema` de la herramienta `extract_trip` (todo en línea, sin
// $ref/$defs) y (3) los tipos TypeScript para Angular
// (projects/admin/src/app/core/models/proposal-extraction.types.ts, generado con
// supabase/functions/_shared/generate-extraction-types.ts).
//
// Sale del modelo real de un servicio dentro de proposals.content (ver
// projects/admin/src/app/core/models/proposal.model.ts y
// core/data/proposal-service-fields.ts): los tipos son los de ProposalServiceType
// y los campos propios de cada tipo se corresponden con service.details.
// Comida → activity con subtype 'meal'; tren → transfer con subtype 'train'.
//
// Formatos: fechas YYYY-MM-DD, horas HH:MM en 24 h, montos como número sin
// símbolos ni separadores de miles, moneda aparte (ISO 4217).
import { z } from 'npm:zod@4';

function isRealDate(value: string): boolean {
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha debe tener formato YYYY-MM-DD')
  .refine(isRealDate, 'La fecha no existe en el calendario')
  .describe('YYYY-MM-DD');
const time24 = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'La hora debe tener formato HH:MM en 24 horas')
  .describe('HH:MM en 24 horas');
const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, 'La moneda debe ser un código ISO 4217 de 3 letras en mayúsculas')
  .describe('Código ISO 4217, p. ej. USD, EUR');
const text = z.string();

const nText = text.nullable();
const nDate = isoDate.nullable();
const nTime = time24.nullable();

export const SERVICE_TYPES = ['flight', 'hotel', 'transfer', 'activity', 'other'] as const;
export const SERVICE_SUBTYPES = ['meal', 'train'] as const;
export const PRICE_KINDS = ['service', 'fee'] as const;
export const MODALITIES = ['private', 'shared'] as const;

/** Texto con el que la modalidad se guarda en service.details (transferType / modality). */
export const MODALITY_LABEL: Record<(typeof MODALITIES)[number], string> = {
  private: 'Privado',
  shared: 'Compartido'
};

const FlightSchema = z.object({
  airline: nText,
  flight_number: nText,
  origin: nText,
  destination: nText,
  departure_time: nTime,
  arrival_time: nTime,
  arrival_date: nDate.describe('Fecha de llegada, sobre todo si es al día siguiente.'),
  cabin: nText,
  baggage: nText
});

const HotelSchema = z.object({
  check_in_date: nDate,
  check_out_date: nDate,
  check_in_time: nTime,
  check_out_time: nTime,
  room_type: nText,
  meal_plan: nText,
  category: nText,
  address: nText,
  guests: nText
});

const TransferSchema = z.object({
  from: nText,
  to: nText,
  vehicle_type: nText,
  passengers: nText,
  baggage: nText
});

const ActivitySchema = z.object({
  duration: nText,
  meeting_point: nText,
  participants: nText,
  included: nText,
  language: nText
});

const ServiceSchema = z.object({
  type: z.enum(SERVICE_TYPES).describe('Tipo de servicio. Comida → activity; tren → transfer.'),
  subtype: z.enum(SERVICE_SUBTYPES).nullable().describe("'meal' para comidas, 'train' para trenes, null en el resto."),
  name: z.string().min(1).describe('Nombre tal como aparece en el documento.'),
  date: nDate,
  time: nTime,
  location: nText,
  description: nText,
  notes: nText.describe("Lo que el documento marca como 'No incluye' en este servicio."),
  modality: z
    .enum(MODALITIES)
    .nullable()
    .describe("'private' si dice PRIVADO; 'shared' si dice REGULAR o COMPARTIDO; null si no lo indica."),
  price: z
    .object({ amount: z.number(), per_person: z.boolean() })
    .nullable()
    .describe('Precio del servicio solo si aparece en una sección explícita de precios, tarifas o cotización.'),
  source_page: z.number().int().min(1).nullable().describe('Número de página del PDF de donde salió.'),
  flight: FlightSchema.nullable().describe('Solo si type es flight.'),
  hotel: HotelSchema.nullable().describe('Solo si type es hotel.'),
  transfer: TransferSchema.nullable().describe('Solo si type es transfer.'),
  activity: ActivitySchema.nullable().describe('Solo si type es activity.')
});

const DaySchema = z.object({
  number: z.number().int().min(1),
  date: nDate,
  base_city: nText,
  title: nText,
  summary: nText,
  services: z.array(ServiceSchema)
});

const PriceLineSchema = z.object({
  concept: z.string().min(1),
  detail: nText,
  amount: z.number().nullable().describe('Monto tal como aparece (por persona si per_person, si no total).'),
  quantity: z.number().nullable().describe('Cantidad, solo si el PDF la indica.'),
  unit_price: z.number().nullable().describe('Precio unitario, solo si el PDF lo indica.'),
  per_person: z.boolean(),
  kind: z.enum(PRICE_KINDS).describe("'fee' para impuestos, tasas y cargos; 'service' para el resto.")
});

export const ExtractionSchema = z.object({
  client: z.object({ name: nText, email: nText, phone: nText }),
  travelers: z.object({
    adults: z.number().int().min(0).nullable(),
    children: z.number().int().min(0).nullable(),
    children_ages: z.array(z.number().int().min(0).max(25))
  }),
  trip: z.object({
    title: nText,
    start_date: nDate,
    end_date: nDate,
    destinations: z.array(text)
  }),
  days: z.array(DaySchema),
  pricing: z
    .object({
    currency: currencyCode.nullable(),
    total: z.number().nullable(),
    other_currencies: z.array(currencyCode).describe('Otras monedas que aparezcan en el PDF además de currency.'),
    lines: z.array(PriceLineSchema)
  })
    .nullable()
    .describe('Solo desde una sección explícita de precios, tarifas o cotización; null si el PDF no la trae.'),
  inclusions: z.array(text),
  exclusions: z.array(text),
  notes: z.array(text),
  missing: z.array(text).describe('Campos que no se encontraron en el PDF.')
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedService = z.infer<typeof ServiceSchema>;
export type ExtractedDay = z.infer<typeof DaySchema>;
export type ExtractedPriceLine = z.infer<typeof PriceLineSchema>;

export interface ExtractionWarning {
  code: string;
  message: string;
}

/** Lo que se guarda en proposal_imports.extracted. */
export interface StoredExtraction extends Extraction {
  warnings: ExtractionWarning[];
  meta: {
    model: string;
    extracted_at: string;
    /** Uso del modelo en esta extracción (sin contenido del PDF ni datos del cliente). */
    usage?: { calls: number; inputTokens: number; outputTokens: number; reasoningTokens: number; costUsd: number | null; totalMs: number };
  };
}

/** input_schema de la herramienta extract_trip: todo en línea, sin $ref/$defs. */
// deno-lint-ignore no-explicit-any
export function extractionToolInputSchema(): Record<string, any> {
  // deno-lint-ignore no-explicit-any
  const schema = z.toJSONSchema(ExtractionSchema, { target: 'draft-7', reused: 'inline', io: 'output' }) as Record<string, any>;
  delete schema.$schema;
  const serialized = JSON.stringify(schema);
  if (serialized.includes('"$ref"') || serialized.includes('"$defs"')) {
    throw new Error('El input_schema generado contiene $ref/$defs');
  }
  return schema;
}

/** Errores de validación legibles, sin valores del documento (solo rutas y motivos). */
export function formatValidationIssues(error: z.ZodError, max = 25): string[] {
  return error.issues.slice(0, max).map((issue) => `${issue.path.join('.') || '(raíz)'}: ${issue.message}`);
}

/** ¿Se extrajo algo útil? Si no, el PDF no se pudo leer. */
export function hasUsefulContent(data: Extraction): boolean {
  return (
    data.days.some((d) => d.services.length > 0) ||
    (data.pricing?.lines.length ?? 0) > 0 ||
    data.pricing?.total != null ||
    !!data.client.name ||
    !!data.trip.start_date
  );
}
