import type { GuardShift } from '@garita/shared';
import type { Tone } from '@/ui';

export interface DayRange {
  desde: string;
  hasta: string;
}

/** Fecha local `AAAA-MM-DD` (la del celular: el vigilador trabaja en la zona del predio). */
export function isoDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Día `AAAA-MM-DD` desplazado `days` días. */
export function addDays(day: string, days: number): string {
  const [y, m, d] = day.split('-').map(Number);
  // En UTC: un cambio de horario local no corre el día.
  return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, (d ?? 1) + days)).toISOString().slice(0, 10);
}

/**
 * Pone `day` en un extremo del rango: si queda invertido el otro extremo lo acompaña, y si supera
 * el tope de la API (un año) el otro extremo se acerca.
 */
export function withEdge(range: DayRange, edge: keyof DayRange, day: string, maxDays: number) {
  const next = { ...range, [edge]: day };
  if (next.desde > next.hasta) next[edge === 'desde' ? 'hasta' : 'desde'] = day;
  if (addDays(next.desde, maxDays - 1) < next.hasta) {
    if (edge === 'desde') next.hasta = addDays(day, maxDays - 1);
    else next.desde = addDays(day, -(maxDays - 1));
  }
  return next;
}

/** Mes completo que contiene `date`, desplazado `offset` meses. */
export function monthRange(date: Date, offset = 0): DayRange {
  const year = date.getFullYear();
  const month = date.getMonth() + offset;
  return { desde: isoDay(new Date(year, month, 1)), hasta: isoDay(new Date(year, month + 1, 0)) };
}

const HOUR = 3_600_000;
const hours = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / HOUR;

/** Horas trabajadas (inicio y cierre reales) y por trabajar (programadas) de una lista. */
export function totals(shifts: GuardShift[]) {
  let worked = 0;
  let planned = 0;
  for (const shift of shifts) {
    if (shift.startedAt && shift.closedAt) {
      // El cierre automático llega después del horario (margen de envío): se cuenta hasta el fin.
      const end =
        shift.status === 'auto_closed' && Date.parse(shift.closedAt) > Date.parse(shift.endsAt)
          ? shift.endsAt
          : shift.closedAt;
      // Un desfasaje de reloj no resta horas.
      worked += Math.max(0, hours(shift.startedAt, end));
    } else if (shift.status === 'scheduled' || shift.status === 'in_progress')
      planned += hours(shift.startsAt, shift.endsAt);
  }
  return { count: shifts.length, worked: Math.round(worked), planned: Math.round(planned) };
}

/** Sello de estado de la tarjeta: el texto siempre dice el estado, el tono solo lo refuerza. */
export function shiftStamp(shift: GuardShift): { label: string; tone: Tone } {
  switch (shift.status) {
    case 'in_progress':
      return { label: 'En curso', tone: 'info' };
    case 'scheduled':
    case 'unassigned':
      return { label: 'Programado', tone: 'neutral' };
    case 'no_show':
    case 'uncovered':
      return { label: 'Ausente', tone: 'danger' };
    case 'cancelled':
    case 'cancelled_by_suspension':
      return { label: 'Cancelado', tone: 'neutral' };
    case 'closed':
    case 'auto_closed': {
      const done = shift.summary && shift.summary.windowsDone === shift.summary.windows;
      return done
        ? { label: 'Completo', tone: 'success' }
        : { label: 'Incompleto', tone: 'warning' };
    }
  }
}

/** Día en que termina (el del instante anterior al fin: un fin a las 00:00 no toca ese día). */
export const endDay = (shift: GuardShift) =>
  dayIn(new Date(Date.parse(shift.endsAt) - 1), shift.site.timezone);

// Un formateador por zona horaria: crearlos es caro en Hermes.
const dayFormats = new Map<string, Intl.DateTimeFormat>();
/** Fecha `AAAA-MM-DD` en la zona del predio (la misma en que se calcula `serviceDate`). */
export function dayIn(date: Date, timeZone: string): string {
  let format = dayFormats.get(timeZone);
  if (!format) {
    try {
      format = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      });
    } catch {
      // Zona inválida: el día del celular, que es donde trabaja el vigilador.
      return isoDay(date);
    }
    dayFormats.set(timeZone, format);
  }
  // Por partes, como `localDate` en la API: el formato completo de `en-CA` varía según el ICU.
  const parts = Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Un turno nocturno toca dos días: el que empieza y el que termina. */
export const touches = (shift: GuardShift, { desde, hasta }: DayRange) =>
  shift.serviceDate <= hasta && endDay(shift) >= desde;

const PENDING = new Set<GuardShift['status']>(['scheduled', 'unassigned']);

/**
 * Separa en próximos (en curso o pendientes sin terminar, ascendente) y anteriores (el más
 * reciente primero). Un turno cerrado, cancelado o ausente va a anteriores aunque su horario siga.
 */
export function splitByToday(shifts: GuardShift[], now: Date) {
  const upcoming: GuardShift[] = [];
  const past: GuardShift[] = [];
  for (const shift of shifts)
    (shift.status === 'in_progress' ||
    (PENDING.has(shift.status) && Date.parse(shift.endsAt) > now.getTime())
      ? upcoming
      : past
    ).push(shift);
  return { upcoming, past: past.reverse() };
}
