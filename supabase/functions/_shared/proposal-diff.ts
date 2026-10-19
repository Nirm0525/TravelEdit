// Diff determinista entre lo extraído del PDF y la propuesta actual. El modelo
// solo extrae; aquí el código compara. Nunca borra nada: lo que está en la
// propuesta y no en el PDF solo se informa (only_in_proposal).
//
// Reglas de emparejamiento (si hay duda → 'new', nunca 'changed'):
//  - Días: por fecha calculada (start_date + dayNumber − 1) cuando la propuesta
//    tiene start_date y el día del PDF trae fecha; dayNumber solo como respaldo
//    (si falta alguna de las dos fechas).
//  - Vuelos: mismo número de vuelo + misma fecha.
//  - Hoteles: mismo tipo + rango de noches que se traslapa (details.checkInDate/
//    checkOutDate). Sin fechas en la propuesta: mismo día + nombre normalizado.
//  - Resto: mismo día + mismo tipo + nombre normalizado igual.
//  - Dos o más candidatos, o un candidato ya emparejado → 'new'.
// Solo se comparan campos estructurados (hora y ficha); la descripción no, porque
// es texto redactado por la asesora y siempre sería "distinta".
import type { Extraction, ExtractedDay, ExtractedPriceLine, ExtractedService } from './proposal-extraction.ts';
import { resolvePriceLine, travelersTotal } from './proposal-pricing.ts';
import { addDays, normalizeName, parseTimeToHHMM } from './proposal-text.ts';

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

// ---------------------------------------------------------------- utilidades

type Rec = Record<string, unknown>;

function asRecord(value: unknown): Rec {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Rec) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const PRICE_TOLERANCE = 1;

function scalarChange<T extends string | number>(
  current: T | null | undefined,
  incoming: T | null | undefined,
  equal: (a: T, b: T) => boolean
): Change<T> {
  const cur = current === undefined || current === '' ? null : current;
  const inc = incoming === undefined || incoming === '' ? null : incoming;
  if (inc === null) {
    return { status: 'unchanged', current: cur, incoming: null }; // el PDF no trae el dato
  }
  if (cur === null) {
    return { status: 'new', current: null, incoming: inc };
  }
  return { status: equal(cur, inc) ? 'unchanged' : 'changed', current: cur, incoming: inc };
}

const sameText = (a: string, b: string) => normalizeName(a) === normalizeName(b);
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const sameDigits = (a: string, b: string) => a.replace(/\D/g, '') === b.replace(/\D/g, '');
const sameExact = <T>(a: T, b: T) => a === b;

// ---------------------------------------------------------------- servicios

const TIME_LIKE = new Set(['time', 'checkIn', 'checkOut', 'arrivalTime']);

/** Campos del servicio extraído, con las mismas claves que service.details. */
export function incomingServiceFields(s: ExtractedService): { time: string | null; details: Record<string, string | null> } {
  const d: Record<string, string | null> = {};
  let time = s.time;
  if (s.type === 'flight' && s.flight) {
    time = s.flight.departure_time ?? s.time;
    Object.assign(d, {
      airline: s.flight.airline,
      flightNumber: s.flight.flight_number,
      origin: s.flight.origin,
      destination: s.flight.destination,
      arrivalTime: s.flight.arrival_time,
      cabin: s.flight.cabin,
      baggage: s.flight.baggage
    });
  } else if (s.type === 'hotel' && s.hotel) {
    Object.assign(d, {
      checkIn: s.hotel.check_in_time,
      checkOut: s.hotel.check_out_time,
      checkInDate: s.hotel.check_in_date,
      checkOutDate: s.hotel.check_out_date,
      roomType: s.hotel.room_type,
      mealPlan: s.hotel.meal_plan,
      category: s.hotel.category,
      address: s.hotel.address,
      guests: s.hotel.guests
    });
  } else if (s.type === 'transfer' && s.transfer) {
    Object.assign(d, {
      transferType: s.transfer.vehicle_type,
      pickupLocation: s.transfer.from,
      dropoffLocation: s.transfer.to,
      passengers: s.transfer.passengers,
      baggage: s.transfer.baggage
    });
  } else if (s.type === 'activity' && s.activity) {
    Object.assign(d, {
      duration: s.activity.duration,
      meetingPoint: s.activity.meeting_point,
      participants: s.activity.participants,
      included: s.activity.included,
      language: s.activity.language
    });
  } else if (s.type === 'other') {
    d.location = s.location;
  }
  return { time, details: d };
}

function toCurrentService(raw: unknown): CurrentServiceView | null {
  const r = asRecord(raw);
  const id = str(r.id);
  if (!id) {
    return null;
  }
  const details: Record<string, string> = {};
  for (const [k, v] of Object.entries(asRecord(r.details))) {
    if (typeof v === 'string') {
      details[k] = v;
    }
  }
  return { id, type: str(r.type), title: str(r.title), time: str(r.time), subtype: str(r.subtype) || null, details };
}

interface CurrentDay {
  id: string;
  number: number;
  date: string | null;
  services: CurrentServiceView[];
}

function readCurrentDays(content: unknown, startDate: string | null): CurrentDay[] {
  return asArray(asRecord(content).days).map((rawDay, index) => {
    const d = asRecord(rawDay);
    const number = typeof d.dayNumber === 'number' ? d.dayNumber : index + 1;
    return {
      id: str(d.id),
      number,
      date: startDate ? addDays(startDate, number - 1) : null,
      services: asArray(d.services).map(toCurrentService).filter((s): s is CurrentServiceView => s !== null)
    };
  });
}

function timesEqual(a: string, b: string): boolean {
  const ta = parseTimeToHHMM(a);
  const tb = parseTimeToHHMM(b);
  if (ta && tb) {
    return ta === tb;
  }
  return normalizeName(a) === normalizeName(b);
}

function compareService(current: CurrentServiceView, incoming: ExtractedService): FieldChange[] {
  const changes: FieldChange[] = [];
  const fields = incomingServiceFields(incoming);

  if (!sameText(current.title, incoming.name)) {
    changes.push({ field: 'name', current: current.title || null, incoming: incoming.name });
  }
  if (fields.time) {
    const currentTime = current.time.trim();
    if (!currentTime || !timesEqual(currentTime, fields.time)) {
      changes.push({ field: 'time', current: currentTime || null, incoming: fields.time });
    }
  }
  if (incoming.subtype && current.subtype !== incoming.subtype) {
    changes.push({ field: 'subtype', current: current.subtype, incoming: incoming.subtype });
  }
  for (const [key, value] of Object.entries(fields.details)) {
    if (value == null || value === '') {
      continue;
    }
    const currentValue = (current.details[key] ?? '').trim();
    const equal = TIME_LIKE.has(key)
      ? timesEqual(currentValue, value)
      : key === 'flightNumber'
        ? sameText(currentValue, value) || normalizeName(currentValue).replace(/ /g, '') === normalizeName(value).replace(/ /g, '')
        : sameText(currentValue, value);
    if (!currentValue || !equal) {
      changes.push({ field: key, current: currentValue || null, incoming: value });
    }
  }
  return changes;
}

function nightsOverlap(aFrom: string, aTo: string, bFrom: string, bTo: string): boolean {
  return aFrom < bTo && bFrom < aTo;
}

function matchDay(incoming: ExtractedDay, current: CurrentDay[], hasStartDate: boolean): CurrentDay | null {
  if (hasStartDate && incoming.date) {
    const byDate = current.filter((d) => d.date === incoming.date);
    return byDate.length === 1 ? byDate[0] : null;
  }
  const byNumber = current.filter((d) => d.number === incoming.number);
  return byNumber.length === 1 ? byNumber[0] : null;
}

// ---------------------------------------------------------------- precios

interface IncomingLine {
  line: ExtractedPriceLine;
  serviceRef: { day_index: number; service_index: number } | null;
  origin: 'pricing_lines' | 'service_price';
}

/**
 * Líneas de precio del PDF sin duplicar:
 *  - pricing.lines es la fuente principal. El precio de un servicio solo sirve
 *    para saber a qué servicio corresponde cada línea (mismo concepto
 *    normalizado, o mismo monto si es único) — nunca crea una segunda línea.
 *  - Si el PDF NO trae pricing.lines, cada precio de servicio es una línea.
 */
export function incomingPriceLines(data: Extraction): IncomingLine[] {
  const priced: { dayIndex: number; serviceIndex: number; service: ExtractedService }[] = [];
  data.days.forEach((day, dayIndex) =>
    day.services.forEach((service, serviceIndex) => {
      if (service.price) {
        priced.push({ dayIndex, serviceIndex, service });
      }
    })
  );

  if (data.pricing.lines.length === 0) {
    return priced.map(({ dayIndex, serviceIndex, service }) => ({
      line: {
        concept: service.name,
        detail: null,
        amount: service.price!.amount,
        quantity: null,
        unit_price: null,
        per_person: service.price!.per_person,
        kind: 'service' as const
      },
      serviceRef: { day_index: dayIndex, service_index: serviceIndex },
      origin: 'service_price' as const
    }));
  }

  const usedServices = new Set<string>();
  return data.pricing.lines.map((line) => {
    let ref: IncomingLine['serviceRef'] = null;
    if (line.kind === 'service') {
      const free = priced.filter((p) => !usedServices.has(`${p.dayIndex}:${p.serviceIndex}`));
      const byName = free.filter((p) => normalizeName(p.service.name) === normalizeName(line.concept));
      const byAmount = line.amount == null ? [] : free.filter((p) => p.service.price!.amount === line.amount);
      const pick = byName.length === 1 ? byName[0] : byName.length === 0 && byAmount.length === 1 ? byAmount[0] : null;
      if (pick) {
        ref = { day_index: pick.dayIndex, service_index: pick.serviceIndex };
        usedServices.add(`${pick.dayIndex}:${pick.serviceIndex}`);
      }
    }
    return { line, serviceRef: ref, origin: 'pricing_lines' as const };
  });
}

function readCurrentLines(content: unknown, key: 'lines' | 'feesLines'): LineView[] {
  return asArray(asRecord(asRecord(content).pricing)[key]).map((raw) => {
    const r = asRecord(raw);
    return {
      id: str(r.id) || undefined,
      label: str(r.label),
      quantity: typeof r.quantity === 'number' ? r.quantity : 0,
      unit_price: typeof r.unitPrice === 'number' ? r.unitPrice : 0
    };
  });
}

// ---------------------------------------------------------------- diff

export function computeDiff(extracted: Extraction, snapshot: ProposalSnapshot): ProposalDiff {
  const incomingTravelers = travelersTotal(extracted.travelers.adults, extracted.travelers.children);
  const currentDays = readCurrentDays(snapshot.content, snapshot.start_date);
  const hasStartDate = !!snapshot.start_date;

  // --- servicios ---
  const taken = new Set<string>();
  const services: ServiceDiffItem[] = [];

  const currentFlat = currentDays.flatMap((day) => day.services.map((service) => ({ day, service })));

  for (const incomingDay of extracted.days) {
    const day = matchDay(incomingDay, currentDays, hasStartDate);

    for (const incoming of incomingDay.services) {
      const incomingDate = incoming.date ?? incomingDay.date;
      let current: CurrentServiceView | null = null;
      let match: MatchReason | null = null;
      let ambiguous = false;

      // Vuelos: número de vuelo + fecha.
      if (incoming.type === 'flight' && incoming.flight?.flight_number) {
        const number = normalizeName(incoming.flight.flight_number).replace(/ /g, '');
        const candidates = currentFlat.filter(
          ({ day: d, service: s }) =>
            s.type === 'flight' &&
            !taken.has(s.id) &&
            normalizeName(s.details.flightNumber ?? '').replace(/ /g, '') === number &&
            (d.date && incomingDate ? d.date === incomingDate : !!day && d.id === day.id)
        );
        if (candidates.length === 1) {
          current = candidates[0].service;
          match = 'flight_number_and_date';
        } else if (candidates.length > 1) {
          ambiguous = true;
        }
      }

      // Hoteles: rango de noches que se traslapa.
      if (!current && !ambiguous && incoming.type === 'hotel' && incoming.hotel?.check_in_date && incoming.hotel.check_out_date) {
        const { check_in_date: from, check_out_date: to } = incoming.hotel;
        const candidates = currentFlat.filter(({ service: s }) => {
          if (s.type !== 'hotel' || taken.has(s.id)) {
            return false;
          }
          const f = s.details.checkInDate;
          const t = s.details.checkOutDate;
          return !!f && !!t && nightsOverlap(from, to, f, t);
        });
        if (candidates.length === 1) {
          current = candidates[0].service;
          match = 'hotel_nights_overlap';
        } else if (candidates.length > 1) {
          ambiguous = true;
        }
      }

      // Resto: mismo día + tipo + nombre normalizado.
      if (!current && !ambiguous && day) {
        const wanted = normalizeName(incoming.name);
        const candidates = day.services.filter(
          (s) => s.type === incoming.type && !taken.has(s.id) && wanted !== '' && normalizeName(s.title) === wanted
        );
        if (candidates.length === 1) {
          current = candidates[0];
          match = 'name_and_day';
        }
      }

      if (current) {
        taken.add(current.id);
      }

      const changed_fields = current ? compareService(current, incoming) : [];
      const foundDay = current ? (currentFlat.find((f) => f.service.id === current!.id)?.day ?? null) : day;
      services.push({
        status: !current ? 'new' : changed_fields.length > 0 ? 'changed' : 'unchanged',
        match,
        day: {
          incoming_number: incomingDay.number,
          incoming_date: incomingDay.date,
          current_day_id: foundDay?.id ?? null,
          current_day_number: foundDay?.number ?? null
        },
        incoming,
        current,
        changed_fields
      });
    }
  }

  const only_in_proposal: OnlyInProposalItem[] = currentFlat
    .filter(({ service }) => !taken.has(service.id))
    .map(({ day, service }) => ({ day_id: day.id, day_number: day.number, service }));

  // --- precios ---
  const currentByKind = { service: readCurrentLines(snapshot.content, 'lines'), fee: readCurrentLines(snapshot.content, 'feesLines') };
  const takenLines = new Set<LineView>();
  const travelersForLines = incomingTravelers ?? snapshot.travelers_count;
  const matchedServiceIds = new Map<string, string>(); // `${dayIndex}:${serviceIndex}` → id de servicio actual
  let serviceCursor = 0;
  for (const [dayIndex, day] of extracted.days.entries()) {
    for (const serviceIndex of day.services.keys()) {
      const current = services[serviceCursor++]?.current;
      if (current) {
        matchedServiceIds.set(`${dayIndex}:${serviceIndex}`, current.id);
      }
    }
  }
  const currentServiceLinks = new Map<string, string>(); // serviceId de una línea actual → id de esa línea
  for (const raw of asArray(asRecord(asRecord(snapshot.content).pricing).lines)) {
    const r = asRecord(raw);
    if (str(r.serviceId) && str(r.id)) {
      currentServiceLinks.set(str(r.serviceId), str(r.id));
    }
  }

  const lines: LineDiffItem[] = [];
  for (const { line, serviceRef, origin } of incomingPriceLines(extracted)) {
    const resolved = resolvePriceLine(line, travelersForLines);
    const incomingView: LineView = { label: line.concept, quantity: resolved.quantity, unit_price: resolved.unitPrice };
    const pool = currentByKind[line.kind];

    let current: LineView | null = null;
    // 1) por servicio ya emparejado (la línea actual con ese serviceId)
    if (serviceRef) {
      const currentServiceId = matchedServiceIds.get(`${serviceRef.day_index}:${serviceRef.service_index}`);
      const lineId = currentServiceId ? currentServiceLinks.get(currentServiceId) : undefined;
      const byService = lineId ? pool.filter((l) => l.id === lineId && !takenLines.has(l)) : [];
      if (byService.length === 1) {
        current = byService[0];
      }
    }
    // 2) por concepto normalizado
    if (!current) {
      const wanted = normalizeName(line.concept);
      const byLabel = pool.filter((l) => !takenLines.has(l) && wanted !== '' && normalizeName(l.label) === wanted);
      if (byLabel.length === 1) {
        current = byLabel[0];
      }
    }
    if (current) {
      takenLines.add(current);
    }

    const changed_fields: FieldChange[] = [];
    if (current) {
      if (Math.abs(current.quantity - incomingView.quantity) > 1e-9) {
        changed_fields.push({ field: 'quantity', current: String(current.quantity), incoming: String(incomingView.quantity) });
      }
      if (Math.abs(current.unit_price - incomingView.unit_price) > 1e-9) {
        changed_fields.push({ field: 'unit_price', current: String(current.unit_price), incoming: String(incomingView.unit_price) });
      }
    }
    lines.push({
      status: !current ? 'new' : changed_fields.length > 0 ? 'changed' : 'unchanged',
      kind: line.kind,
      incoming: incomingView,
      current,
      changed_fields,
      service_ref: serviceRef,
      origin,
      assumption: resolved.assumption
    });
  }

  const linesOnlyInProposal = (['service', 'fee'] as const).flatMap((kind) =>
    currentByKind[kind].filter((l) => !takenLines.has(l)).map((l) => ({ ...l, kind }))
  );

  const countBy = <T extends { status: ChangeStatus }>(items: T[], onlyCount: number) => ({
    new: items.filter((i) => i.status === 'new').length,
    changed: items.filter((i) => i.status === 'changed').length,
    unchanged: items.filter((i) => i.status === 'unchanged').length,
    only_in_proposal: onlyCount
  });

  return {
    version: 1,
    base_updated_at: snapshot.updated_at,
    client: {
      name: scalarChange(snapshot.client_name, extracted.client.name, sameText),
      email: scalarChange(snapshot.client_email, extracted.client.email, sameEmail),
      phone: scalarChange(snapshot.client_phone, extracted.client.phone, sameDigits)
    },
    travelers: scalarChange(snapshot.travelers_count, incomingTravelers, sameExact),
    trip: {
      start_date: scalarChange(snapshot.start_date, extracted.trip.start_date, sameExact),
      end_date: scalarChange(snapshot.end_date, extracted.trip.end_date, sameExact)
    },
    pricing: {
      currency: scalarChange(snapshot.currency?.toUpperCase() ?? null, extracted.pricing.currency, sameExact),
      total: scalarChange(snapshot.pricing_total || null, extracted.pricing.total, (a, b) => Math.abs(a - b) <= PRICE_TOLERANCE),
      lines,
      only_in_proposal: linesOnlyInProposal
    },
    services,
    only_in_proposal,
    summary: {
      services: countBy(services, only_in_proposal.length),
      lines: countBy(lines, linesOnlyInProposal.length)
    }
  };
}
