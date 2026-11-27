/** Días en la numeración de JS (0 = domingo), con su nombre largo y una abreviatura legible. */
export const WEEKDAYS: Record<number, { long: string; short: string }> = {
  0: { long: 'Domingo', short: 'Dom' },
  1: { long: 'Lunes', short: 'Lun' },
  2: { long: 'Martes', short: 'Mar' },
  3: { long: 'Miércoles', short: 'Mié' },
  4: { long: 'Jueves', short: 'Jue' },
  5: { long: 'Viernes', short: 'Vie' },
  6: { long: 'Sábado', short: 'Sáb' },
};
/** La semana del panel empieza el lunes. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Si la hora de fin es anterior o igual al inicio, el turno termina al día siguiente. */
export const crossesMidnight = (start: string, end: string) =>
  Boolean(start && end && end <= start);

/** "8 dic" (con año si se pide) a partir de una fecha de calendario YYYY-MM-DD. */
export function shortDate(date: string, withYear = false): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    timeZone: 'UTC',
  });
}

/** "3 nov – 8 dic 2026"; el año de inicio solo si difiere del final. */
export function periodLabel(start: string, end: string): string {
  return `${shortDate(start, start.slice(0, 4) !== end.slice(0, 4))} – ${shortDate(end, true)}`;
}

/** "5 oct 20:00" en la zona de la empresa. */
export function dateTime(value: string, timezone: string): string {
  return new Date(value).toLocaleString('es-AR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  });
}
