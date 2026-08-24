export function relativeTime(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(ms / (60 * 1000));

  if (minutes < 1) {
    return 'Hace un momento';
  }
  if (minutes < 60) {
    return `Hace ${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `Hace ${hours} hora${hours === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'Ayer';
  }
  if (days < 7) {
    return `Hace ${days} días`;
  }

  return new Date(isoDate).toLocaleDateString('es', { day: 'numeric', month: 'short', year: 'numeric' });
}
