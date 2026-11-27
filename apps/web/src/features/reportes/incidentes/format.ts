/** Duración en minutos con un decimal; sin dato, raya. */
export function minutes(value: number | null) {
  return value === null
    ? '—'
    : `${(value / 60000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} min`;
}
