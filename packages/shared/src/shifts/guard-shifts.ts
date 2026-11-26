import { z } from 'zod';

/** Turnos por página de `GET /mis-turnos/rango`. */
export const GUARD_SHIFTS_PAGE_SIZE = 50;

/** Rango libre de fechas de servicio (inclusive) y cursor opaco de la página siguiente. */
export const guardShiftsQuerySchema = z
  .object({ desde: z.iso.date(), hasta: z.iso.date(), cursor: z.string().min(1).optional() })
  .refine((query) => query.desde <= query.hasta, {
    message: 'desde debe ser anterior o igual a hasta',
    path: ['hasta'],
  });
export type GuardShiftsQuery = z.infer<typeof guardShiftsQuerySchema>;

/** Lo que hizo el vigilador en un turno ya iniciado: ventanas cumplidas, puntos e incidentes. */
export const guardShiftSummarySchema = z.object({
  windows: z.number().int(),
  windowsDone: z.number().int(),
  recorded: z.number().int(),
  expected: z.number().int(),
  incidents: z.number().int(),
});

export const guardShiftSchema = z.object({
  id: z.string(),
  status: z.enum([
    'scheduled',
    'unassigned',
    'uncovered',
    'no_show',
    'cancelled',
    'in_progress',
    'closed',
    'auto_closed',
    'cancelled_by_suspension',
  ]),
  serviceDate: z.iso.date(),
  /** Horario de la asignación del vigilador (puede diferir del turno si hubo relevo). */
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  site: z.object({ id: z.string(), name: z.string(), timezone: z.string() }),
  rounds: z.array(z.string()),
  summary: guardShiftSummarySchema.nullable(),
});
export type GuardShift = z.infer<typeof guardShiftSchema>;

export const guardShiftsPageSchema = z.object({
  items: z.array(guardShiftSchema),
  nextCursor: z.string().nullable(),
});
export type GuardShiftsPage = z.infer<typeof guardShiftsPageSchema>;
