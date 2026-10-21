// Cliente supabase-js FALSO para probar Edge Functions sin red: tablas en memoria, consultas encadenadas
// (.from().select().eq()...maybeSingle()) y un registro de escrituras, rpc y llamadas de Auth admin.
// Solo implementa lo que usan las pruebas; no pretende ser un PostgREST completo.
export type Row = Record<string, unknown>;

export class FakeSupabase {
  tables: Record<string, Row[]> = {};
  /** Escrituras intentadas: «insert|update|delete tabla». Una función que debe rechazar sin mutar deja esto vacío. */
  writes: string[] = [];
  rpcCalls: string[] = [];
  authAdminCalls: string[] = [];
  rpcResults: Record<string, unknown> = {};

  from(table: string) {
    const db = this;
    const filters: [string, unknown][] = [];
    const builder = {
      select(_columns?: string) {
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      maybeSingle() {
        const row = (db.tables[table] ?? []).find((r) => filters.every(([c, v]) => r[c] === v)) ?? null;
        return Promise.resolve({ data: row ? { ...row } : null, error: null });
      },
      insert(_row: unknown) {
        db.writes.push(`insert ${table}`);
        return Promise.resolve({ data: null, error: null });
      },
      update(_patch: unknown) {
        db.writes.push(`update ${table}`);
        return builder;
      },
      delete() {
        db.writes.push(`delete ${table}`);
        return builder;
      },
      // Para `await client.from(t).update(...).eq(...)` (sin maybeSingle).
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve({ data: null, error: null }).then(resolve);
      }
    };
    return builder;
  }

  rpc(name: string) {
    this.rpcCalls.push(name);
    return Promise.resolve({ data: this.rpcResults[name] ?? null, error: null });
  }

  /** Usuario que devuelve auth.getUser(token); null simula un token inválido. */
  user: { id: string } | null = { id: 'user-1' };

  auth = {
    getUser: (_token: string) => Promise.resolve(this.user ? { data: { user: this.user }, error: null } : { data: { user: null }, error: { message: 'invalid' } }),
    admin: {
      getUserById: (id: string) => {
        this.authAdminCalls.push(id);
        return Promise.resolve({ data: { user: { email: 'asesora@example.com' } }, error: null });
      }
    }
  };
}
