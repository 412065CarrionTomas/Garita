import { z } from 'zod';
import type { StatusTone } from '@/components/status-badge';

const versionSchema = z.looseObject({
  windowStartLocal: z.string(),
  windowEndLocal: z.string(),
  frequencyMinutes: z.number(),
});

/** Un turno tal como lo devuelven GET /turnos y GET /turnos/:id. */
export const shiftRowSchema = z.looseObject({
  id: z.string(),
  siteId: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  serviceDate: z.string(),
  status: z.string(),
  scheduleId: z.string().nullable().optional(),
  individuallyModified: z.boolean().optional(),
  minutesToSignal: z.number().nullable().optional(),
  site: z.looseObject({
    name: z.string(),
    company: z.looseObject({ timezone: z.string() }),
    connectivityType: z.string().optional(),
    minutesToSignal: z.number().optional(),
  }),
  assignments: z.array(
    z.looseObject({
      guard: z
        .looseObject({
          id: z.string(),
          firstName: z.string(),
          lastName: z.string(),
          status: z.string(),
        })
        .nullable(),
    }),
  ),
  rounds: z.array(
    z.looseObject({
      roundId: z.string(),
      round: z.looseObject({ name: z.string(), currentVersion: versionSchema.nullable() }),
    }),
  ),
});
export type ShiftRow = z.infer<typeof shiftRowSchema>;
export const shiftPageSchema = z.object({ items: z.array(shiftRowSchema), total: z.number() });

export const sitesSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    company: z.looseObject({ timezone: z.string() }),
  }),
);
export const roundsSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    status: z.enum(['active', 'inactive']),
    currentVersion: versionSchema.nullable(),
  }),
);

// En curso lleva tilde; programado y cancelado, recuadro punteado; lo cerrado va en tinta.
export const SHIFT_STATES: Partial<Record<string, { label: string; tone: StatusTone }>> = {
  scheduled: { label: 'Programado', tone: 'neutral' },
  unassigned: { label: 'Sin vigilador', tone: 'warning' },
  in_progress: { label: 'En curso', tone: 'success' },
  closed: { label: 'Cerrado', tone: 'info' },
  auto_closed: { label: 'Cerrado por el sistema', tone: 'warning' },
  cancelled: { label: 'Cancelado', tone: 'neutral' },
  cancelled_by_suspension: { label: 'Cancelado por suspensión', tone: 'neutral' },
  no_show: { label: 'No presentado', tone: 'danger' },
  uncovered: { label: 'Sin cobertura', tone: 'danger' },
};

/** Columnas de la lista que ordena el servidor, con su nombre en `orden`. */
export const LIST_SORT_IDS: Record<string, string> = { date: 'inicio', site: 'predio' };

/** Huecos de cobertura: lo que el supervisor tiene que resolver. */
export const PROBLEM_STATUSES = new Set(['unassigned', 'no_show', 'uncovered']);
export const isCancelled = (status: string) => status.startsWith('cancelled');
export const isFinished = (status: string) => ['closed', 'auto_closed'].includes(status);

export type ShiftOrigin = 'manual' | 'schedule' | 'modified';
export function shiftOrigin(shift: {
  scheduleId?: string | null;
  individuallyModified?: boolean;
}): ShiftOrigin {
  if (!shift.scheduleId) return 'manual';
  return shift.individuallyModified ? 'modified' : 'schedule';
}
export const ORIGIN_LABELS: Record<ShiftOrigin, string> = {
  manual: 'Cargado a mano',
  schedule: 'Generado por una programación',
  modified: 'De una programación, editado a mano',
};

export function guardName(guard: { firstName: string; lastName: string } | null | undefined) {
  return guard ? `${guard.firstName} ${guard.lastName}`.trim() : null;
}

export function formatShiftTime(value: string, timezone: string): string {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: timezone,
  }).format(new Date(value));
}

export function formatDateTime(value: string, timezone: string): { date: string; time: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .map(({ type, value: part }) => [type, part]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/** "lun 23" / "23 nov 2026" a partir de una fecha de calendario (YYYY-MM-DD). */
export function calendarDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('es-AR', { ...options, timeZone: 'UTC' });
}

export function timeToMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
}

/**
 * Qué se puede hacer con un hueco, con las mismas condiciones que acepta la API: un turno sin
 * vigilador que todavía no empezó se asigna editándolo; uno sin vigilador o sin cobertura que
 * está en hora se cubre reasignándolo. Un no presentado ya terminó: es historia, sin acción.
 */
export function gapAction(
  shift: { status: string; startsAt: string; endsAt: string },
  now: number,
): 'assign' | 'cover' | null {
  if (Date.parse(shift.endsAt) <= now) return null;
  if (shift.status === 'unassigned') return Date.parse(shift.startsAt) > now ? 'assign' : 'cover';
  return shift.status === 'uncovered' ? 'cover' : null;
}

/** Turno que todavía se puede editar o cancelar: no empezó, ni siquiera antes de hora. */
export const isEditable = (shift: { status: string; startsAt: string }, now: number) =>
  (shift.status === 'scheduled' || shift.status === 'unassigned') &&
  Date.parse(shift.startsAt) > now;

/** Minutos hasta tener señal de un predio sin cobertura (null si tiene señal). */
export function signalMinutes(site: {
  connectivityType?: unknown;
  minutesToSignal?: unknown;
}): number | null {
  return site.connectivityType === 'without_signal' && typeof site.minutesToSignal === 'number'
    ? site.minutesToSignal
    : null;
}

/** Fecha de calendario YYYY-MM-DD válida (para no confiar en lo que trae la URL). */
export const isCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));

/** Hoy (YYYY-MM-DD) en la zona horaria dada. */
export const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());

/** Focos de la planilla que se eligen desde la franja de cifras. */
export const BOARD_FOCUS = {
  asignar: (shift: { status: string; startsAt: string; endsAt: string }, now: number) =>
    gapAction(shift, now) === 'assign',
  cubrir: (shift: { status: string; startsAt: string; endsAt: string }, now: number) =>
    gapAction(shift, now) === 'cover',
  ausencias: (shift: { status: string }) => shift.status === 'no_show',
} as const;
export type BoardFocus = keyof typeof BOARD_FOCUS;
