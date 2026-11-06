// Base en memoria que imita las funciones SQL geocode_* (0057 y 0058), COMPARTIDA por todas las «instancias» de una prueba.
import type { ClaimState } from './handler.ts';
import type { GeocodeCandidate } from './geocoder.ts';

/** Lo que hacen las funciones geocode_* de 0057 y 0058, en memoria y COMPARTIDO por todas las «instancias» de la prueba. */
export class FakeDb {
  rows = new Map<string, { status: 'pending' | 'ready'; results: GeocodeCandidate[] | null; expiresAt: number }>();
  nextSlot = 0;
  stores: { key: string; count: number; ttl: number }[] = [];
  backoffs: number[] = [];
  releases = 0;
  /** Llamadas externas consumidas hoy por ámbito (lo que hace geocode_quota_take en la base). */
  usage = new Map<string, number>();
  quota = (scope: string, limit: number, take: boolean) => {
    const used = this.usage.get(scope) ?? 0;
    if (take && used < limit) {
      this.usage.set(scope, used + 1);
      return Promise.resolve({ allowed: true, used: used + 1, resetsInSeconds: 3600 });
    }
    return Promise.resolve({ allowed: !take && used < limit, used, resetsInSeconds: 3600 });
  };
  /** Filas de consultas (sin el marcador de pausa del proveedor, que es una fila especial de la misma tabla). */
  get queryRowCount() {
    return [...this.rows.keys()].filter((k) => k !== '!provider-pause').length;
  }
  pauseMarker() {
    return this.rows.get('!provider-pause');
  }

  claim = (_p: string, key: string, _q: string, lease: number): Promise<{ state: ClaimState; results: unknown }> => {
    const now = Date.now();
    const row = this.rows.get(key);
    if (row && row.expiresAt > now) {
      return Promise.resolve(row.status === 'ready' ? { state: 'hit', results: row.results } : { state: 'wait', results: null });
    }
    this.rows.set(key, { status: 'pending', results: null, expiresAt: now + lease * 1000 });
    return Promise.resolve({ state: 'claimed', results: null });
  };
  store = (_p: string, key: string, results: GeocodeCandidate[], ttl: number) => {
    this.rows.set(key, { status: 'ready', results, expiresAt: Date.now() + ttl * 1000 });
    this.stores.push({ key, count: results.length, ttl });
    return Promise.resolve();
  };
  release = (_p: string, key: string) => {
    if (key !== '!provider-pause') this.releases++;
    if (this.rows.get(key)?.status === 'pending') this.rows.delete(key);
    return Promise.resolve();
  };
  reserveSlot = (_p: string, interval: number, maxWait: number) => {
    const now = Date.now();
    const start = Math.max(this.nextSlot, now);
    if (start - now > maxWait) return Promise.resolve(-1);
    this.nextSlot = start + interval;
    return Promise.resolve(start - now);
  };
  backoff = (_p: string, seconds: number) => {
    this.backoffs.push(seconds);
    this.nextSlot = Math.max(this.nextSlot, Date.now() + seconds * 1000);
    return Promise.resolve();
  };
}
