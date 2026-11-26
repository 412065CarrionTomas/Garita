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
  site: z.looseObject({ name: z.string(), company: z.looseObject({ timezone: z.string() }) }),
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
