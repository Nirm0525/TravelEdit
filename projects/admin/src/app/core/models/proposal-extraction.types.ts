// GENERADO — no editar a mano.
// Fuente: supabase/functions/_shared/proposal-extraction.ts (schema zod) y
// supabase/functions/_shared/proposal-diff.ts (interfaces del diff).
// Regenerar: deno run -A supabase/functions/_shared/generate-extraction-types.ts

export type TripExtraction = {
  client: {
    name: string | null;
    email: string | null;
    phone: string | null;
  };
  travelers: {
    adults: number | null;
    children: number | null;
    children_ages: number[];
  };
  trip: {
    title: string | null;
    start_date: string | null;
    end_date: string | null;
    destinations: string[];
  };
  days: {
    number: number;
    date: string | null;
    base_city: string | null;
    title: string | null;
    summary: string | null;
    services: {
      /** Tipo de servicio. Comida → activity; tren → transfer. */
      type: "flight" | "hotel" | "transfer" | "activity" | "other";
      /** 'meal' para comidas, 'train' para trenes, null en el resto. */
      subtype: "meal" | "train" | null;
      /** Nombre tal como aparece en el documento. */
      name: string;
      date: string | null;
      time: string | null;
      location: string | null;
      description: string | null;
      /** Lo que el documento marca como 'No incluye' en este servicio. */
      notes: string | null;
      /** 'private' si dice PRIVADO; 'shared' si dice REGULAR o COMPARTIDO; null si no lo indica. */
      modality: "private" | "shared" | null;
      /** Precio del servicio solo si aparece en una sección explícita de precios, tarifas o cotización. */
      price: {
        amount: number;
        per_person: boolean;
      } | null;
      /** Número de página del PDF de donde salió. */
      source_page: number | null;
      /** Solo si type es flight. */
      flight: {
        airline: string | null;
        flight_number: string | null;
        origin: string | null;
        destination: string | null;
        departure_time: string | null;
        arrival_time: string | null;
        /** Fecha de llegada, sobre todo si es al día siguiente. */
        arrival_date: string | null;
        cabin: string | null;
        baggage: string | null;
      } | null;
      /** Solo si type es hotel. */
      hotel: {
        check_in_date: string | null;
        check_out_date: string | null;
        check_in_time: string | null;
        check_out_time: string | null;
        room_type: string | null;
        meal_plan: string | null;
        category: string | null;
        address: string | null;
        guests: string | null;
      } | null;
      /** Solo si type es transfer. */
      transfer: {
        from: string | null;
        to: string | null;
        vehicle_type: string | null;
        passengers: string | null;
        baggage: string | null;
      } | null;
      /** Solo si type es activity. */
      activity: {
        duration: string | null;
        meeting_point: string | null;
        participants: string | null;
        included: string | null;
        language: string | null;
      } | null;
    }[];
  }[];
  /** Solo desde una sección explícita de precios, tarifas o cotización; null si el PDF no la trae. */
  pricing: {
    currency: string | null;
    total: number | null;
    /** Otras monedas que aparezcan en el PDF además de currency. */
    other_currencies: string[];
    lines: {
      concept: string;
      detail: string | null;
      /** Monto tal como aparece (por persona si per_person, si no total). */
      amount: number | null;
      /** Cantidad, solo si el PDF la indica. */
      quantity: number | null;
      /** Precio unitario, solo si el PDF lo indica. */
      unit_price: number | null;
      per_person: boolean;
      /** 'fee' para impuestos, tasas y cargos; 'service' para el resto. */
      kind: "service" | "fee";
    }[];
  } | null;
  inclusions: string[];
  exclusions: string[];
  notes: string[];
  /** Campos que no se encontraron en el PDF. */
  missing: string[];
};

export type ExtractedDay = TripExtraction['days'][number];
export type ExtractedService = ExtractedDay['services'][number];
export type ExtractedPriceLine = NonNullable<TripExtraction['pricing']>['lines'][number];

export interface ExtractionWarning {
  code: string;
  message: string;
}

/** Lo que se guarda en proposal_imports.extracted. */
export interface StoredExtraction extends TripExtraction {
  warnings: ExtractionWarning[];
  meta: { model: string; extracted_at: string };
}

export type ChangeStatus = 'new' | 'changed' | 'unchanged';

export interface Change<T> {
  status: ChangeStatus;
  current: T | null;
  incoming: T | null;
}

export interface FieldChange {
  field: string;
  current: string | null;
  incoming: string | null;
}

export interface CurrentServiceView {
  id: string;
  type: string;
  title: string;
  time: string;
  subtype: string | null;
  details: Record<string, string>;
}

export type MatchReason = 'flight_number_and_date' | 'hotel_nights_overlap' | 'name_and_day';

export interface ServiceDiffItem {
  status: ChangeStatus;
  match: MatchReason | null;
  day: { incoming_number: number; incoming_date: string | null; current_day_id: string | null; current_day_number: number | null };
  incoming: ExtractedService;
  current: CurrentServiceView | null;
  changed_fields: FieldChange[];
}

export interface OnlyInProposalItem {
  day_id: string;
  day_number: number;
  service: CurrentServiceView;
}

export interface LineView {
  id?: string;
  label: string;
  quantity: number;
  unit_price: number;
}

export interface LineDiffItem {
  status: ChangeStatus;
  kind: 'service' | 'fee';
  incoming: LineView;
  current: LineView | null;
  changed_fields: FieldChange[];
  /** Servicio del PDF al que corresponde la línea (para asignar serviceId en la Fase 3). */
  service_ref: { day_index: number; service_index: number } | null;
  origin: 'pricing_lines' | 'service_price';
  assumption: string | null;
}

export interface ProposalDiff {
  version: 1;
  base_updated_at: string;
  client: { name: Change<string>; email: Change<string>; phone: Change<string> };
  travelers: Change<number>;
  trip: { start_date: Change<string>; end_date: Change<string> };
  pricing: {
    currency: Change<string>;
    total: Change<number>;
    lines: LineDiffItem[];
    only_in_proposal: (LineView & { kind: 'service' | 'fee' })[];
  };
  services: ServiceDiffItem[];
  only_in_proposal: OnlyInProposalItem[];
  summary: {
    services: Record<ChangeStatus | 'only_in_proposal', number>;
    lines: Record<ChangeStatus | 'only_in_proposal', number>;
  };
}

export interface ProposalSnapshot {
  updated_at: string;
  client_name: string | null;
  client_email: string | null;
  client_phone: string | null;
  start_date: string | null;
  end_date: string | null;
  travelers_count: number | null;
  currency: string | null;
  pricing_total: number | null;
  content: unknown;
}
