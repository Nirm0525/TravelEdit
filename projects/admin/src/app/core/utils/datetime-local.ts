/**
 * Conversión entre un instante guardado en la base (ISO, normalmente en UTC) y el valor
 * de un <input type="datetime-local">, que siempre se escribe y se lee en HORA LOCAL del
 * navegador, sin zona horaria.
 *
 * Error que esto evita: tomar `iso.slice(0, 16)` muestra la hora UTC como si fuera local,
 * así que la fecha que se ve no es la que quedó guardada (la diferencia es la zona horaria
 * de quien edita, p. ej. 6 h en Honduras) y cada guardado posterior la desplaza.
 */
export function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Valor de un datetime-local (hora local) → ISO en UTC; null si está vacío o es inválido. */
export function fromDatetimeLocal(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Mientras se escribe el año con el teclado, el navegador emite valores válidos a medias
 * ("0002-10-25T10:00", luego "0020…", "0202…", "2027…"). Esos valores no son fechas que
 * alguien quiera guardar: se descartan para no vencer la propuesta por un instante.
 */
export function isPlausibleDatetimeLocal(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && date.getFullYear() >= 2000;
}
