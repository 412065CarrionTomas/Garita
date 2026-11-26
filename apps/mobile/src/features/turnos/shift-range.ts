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
    if (shift.startedAt && shift.closedAt) worked += hours(shift.startedAt, shift.closedAt);
    else if (shift.status === 'scheduled' || shift.status === 'in_progress')
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
export const endDay = (shift: GuardShift) => isoDay(new Date(Date.parse(shift.endsAt) - 1));

/** Un turno nocturno toca dos días: el que empieza y el que termina. */
export const touches = (shift: GuardShift, { desde, hasta }: DayRange) =>
  shift.serviceDate <= hasta && endDay(shift) >= desde;

/** Separa en próximos (sin terminar, ascendente) y anteriores (el más reciente primero). */
export function splitByToday(shifts: GuardShift[], now: Date) {
  const upcoming: GuardShift[] = [];
  const past: GuardShift[] = [];
  for (const shift of shifts)
    (shift.status === 'in_progress' || Date.parse(shift.endsAt) > now.getTime()
      ? upcoming
      : past
    ).push(shift);
  return { upcoming, past: past.reverse() };
}
