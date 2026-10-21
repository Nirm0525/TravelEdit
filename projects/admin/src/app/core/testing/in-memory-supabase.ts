// Cliente supabase-js EN MEMORIA para pruebas de humo del panel: una «base» con tablas de filas (snake_case, como las de Supabase),
// consultas encadenables (select/eq/order/range/limit/insert/update/delete) y un registro de llamadas a Edge Functions y RPC.
// Imita lo que la base real hace por defecto al insertar (id, estado draft, kind 'proposal' si no se envía…) para que los
// errores de «no se envió el kind» se noten. No pretende ser un PostgREST completo y NUNCA habla con una base real.
export type Row = Record<string, any>;

let counter = 0;
const uuid = (): string => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

export interface RecordedCall {
  name: string;
  body: unknown;
}

export class InMemorySupabase {
  tables: Record<string, Row[]> = { proposals: [], proposal_service_attachments: [], leads: [] };
  functionCalls: RecordedCall[] = [];
  /** Respuesta de una Edge Function por nombre (para simular prepare-upload, 403, 404…). Sin handler: {}. */
  functionResults: Record<string, (body: any) => { data: unknown; error: unknown }> = {};
  rpcCalls: RecordedCall[] = [];
  rpcResults: Record<string, unknown> = {};
  /** Orden de los efectos sobre la tabla de propuestas: «insert», «update», «delete» (para comprobar qué se escribió). */
  writes: { table: string; op: string; payload?: unknown }[] = [];

  private defaults(table: string, row: Row): Row {
    if (table !== 'proposals') {
      return { id: uuid(), created_at: new Date().toISOString(), ...row };
    }
    const now = new Date().toISOString();
    return {
      id: uuid(),
      kind: 'proposal', // el DEFAULT de la base: un insert que no envíe kind quedaría como propuesta
      public_token: uuid(),
      lead_id: null,
      status: 'draft',
      client_email: null,
      destination_text: null,
      start_date: null,
      end_date: null,
      travelers_count: null,
      advisor_id: null,
      currency: 'USD',
      access_required: true,
      content: {},
      title: null,
      cover_image_path: null,
      pricing_subtotal: 0,
      pricing_fees: 0,
      pricing_total: 0,
      terms_accepted: false,
      accepted_at: null,
      accepted_by_name: null,
      service_choices: {},
      service_comments: {},
      feedback_sent_at: null,
      published_at: null,
      shared_at: null,
      viewed_at: null,
      expires_at: null,
      origin_channel: 'other',
      created_by: null,
      created_at: now,
      updated_at: now,
      ...row
    };
  }

  private query(table: string) {
    const db = this;
    const filters: [string, unknown][] = [];
    let mode: 'select' | 'insert' | 'update' | 'delete' = 'select';
    let payload: Row | undefined;
    let head = false;
    let wantsCount = false;
    let range: [number, number] | null = null;
    let limit: number | null = null;

    const matched = () => (db.tables[table] ?? []).filter((r) => filters.every(([c, v]) => r[c] === v));

    const run = (): { data: unknown; count: number | null; error: null } => {
      const rows = db.tables[table] ?? (db.tables[table] = []);
      if (mode === 'insert') {
        const created = db.defaults(table, payload!);
        rows.unshift(created);
        db.writes.push({ table, op: 'insert', payload });
        return { data: [{ ...created }], count: null, error: null };
      }
      if (mode === 'update') {
        const hit = matched();
        for (const r of hit) {
          Object.assign(r, payload, { updated_at: new Date().toISOString() });
          if (table === 'proposals' && payload && 'content' in payload) {
            r['title'] = (payload['content'] as Row)?.['cover']?.title ?? null;
          }
        }
        db.writes.push({ table, op: 'update', payload });
        return { data: hit.map((r) => ({ ...r })), count: null, error: null };
      }
      if (mode === 'delete') {
        const hit = matched();
        db.tables[table] = rows.filter((r) => !hit.includes(r));
        db.writes.push({ table, op: 'delete' });
        return { data: null, count: null, error: null };
      }
      let hit = matched();
      const total = hit.length;
      if (range) {
        hit = hit.slice(range[0], range[1] + 1);
      }
      if (limit !== null) {
        hit = hit.slice(0, limit);
      }
      return { data: head ? null : hit.map((r) => ({ ...r })), count: wantsCount ? total : null, error: null };
    };

    const builder: Record<string, any> = {
      select: (_columns?: string, options?: { count?: string; head?: boolean }) => {
        head = options?.head === true;
        wantsCount = options?.count === 'exact';
        return builder;
      },
      insert: (row: Row) => {
        mode = 'insert';
        payload = row;
        return builder;
      },
      update: (patch: Row) => {
        mode = 'update';
        payload = patch;
        return builder;
      },
      delete: () => {
        mode = 'delete';
        return builder;
      },
      eq: (column: string, value: unknown) => {
        filters.push([column, value]);
        return builder;
      },
      or: () => builder,
      order: () => builder,
      range: (from: number, to: number) => {
        range = [from, to];
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: () => {
        const { data, error } = run();
        return Promise.resolve({ data: ((data as Row[] | null) ?? [])[0] ?? null, error });
      },
      single: () => {
        const { data, error } = run();
        return Promise.resolve({ data: ((data as Row[] | null) ?? [])[0] ?? null, error });
      },
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(run()).then(resolve, reject)
    };
    return builder;
  }

  client = {
    from: (table: string) => this.query(table),
    rpc: (name: string, body?: unknown) => {
      this.rpcCalls.push({ name, body });
      return Promise.resolve({ data: this.rpcResults[name] ?? null, error: null });
    },
    functions: {
      invoke: (name: string, options?: { body?: unknown }) => {
        this.functionCalls.push({ name, body: options?.body });
        const handler = this.functionResults[name];
        return Promise.resolve(handler ? handler(options?.body) : { data: {}, error: null });
      }
    },
    storage: { from: () => ({ uploadToSignedUrl: async () => ({ data: {}, error: null }) }) }
  };

  /** Nombres de las Edge Functions invocadas, en orden. */
  calledFunctions(): string[] {
    return this.functionCalls.map((c) => c.name);
  }
}
