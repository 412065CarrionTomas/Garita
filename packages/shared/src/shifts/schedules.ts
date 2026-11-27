import { z } from 'zod';
import { isReportExportPeriodAllowed } from '../reports/export';
import { localDateTimeToUtc } from '../rounds/windows';

export function scheduleDateOffset(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const fields = z.strictObject({
  siteId: z.string().min(1),
  guardId: z.string().min(1),
  weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  startTime: localTime,
  endTime: localTime,
  roundIds: z.array(z.string().min(1)).min(1),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
});
export const shiftScheduleDefinitionSchema = fields.superRefine((value, context) => {
  if (value.startDate > value.endDate)
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'La fecha final debe ser posterior o igual a la inicial.',
    });
  for (const key of ['weekdays', 'roundIds'] as const)
    if (new Set<string | number>(value[key]).size !== value[key].length)
      context.addIssue({ code: 'custom', path: [key], message: 'No se pueden repetir valores.' });
});
export const shiftScheduleInputSchema = shiftScheduleDefinitionSchema.superRefine(
  (value, context) => {
    if (
      !z.iso.date().safeParse(value.endDate).success ||
      !z.iso.date().safeParse(value.startDate).success
    )
      return;
    if (!isReportExportPeriodAllowed(value.startDate, scheduleDateOffset(value.endDate, 1)))
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'El período debe ser de 1 día a 3 meses, con la fecha final incluida.',
      });
  },
);
export const shiftSchedulePatchSchema = fields.partial();
export const shiftScheduleExtensionSchema = z.strictObject({ endDate: z.iso.date() });
/** Días antes del fin en que una programación vigente pasa a "por vencer". */
export const SCHEDULE_EXPIRING_DAYS = 14;
export const SCHEDULE_LIST_STATES = ['vigente', 'por_vencer', 'finalizada', 'cancelada'] as const;
export type ScheduleListState = (typeof SCHEDULE_LIST_STATES)[number];
export const shiftScheduleQuerySchema = z.strictObject({
  predio: z.string().optional(),
  vigilador: z.string().optional(),
  /** Sin estado: las vigentes (incluye las por vencer). */
  estado: z.enum(SCHEDULE_LIST_STATES).optional(),
  q: z.string().trim().max(100).optional(),
});
export type ShiftScheduleQuery = z.infer<typeof shiftScheduleQuerySchema>;
export type ShiftScheduleInput = z.infer<typeof shiftScheduleInputSchema>;

export const scheduledShiftSchema = z.object({
  serviceDate: z.iso.date(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type ScheduledShift = z.infer<typeof scheduledShiftSchema>;
export const schedulePreviewSchema = z.object({
  timezone: z.string(),
  invitationPending: z.boolean(),
  shifts: z.array(
    scheduledShiftSchema.extend({
      conflicts: z.array(
        z.object({ shiftId: z.string(), startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
      ),
    }),
  ),
  uncoveredWindows: z.array(
    z.object({
      roundId: z.string(),
      startUtc: z.iso.datetime(),
      endUtc: z.iso.datetime(),
      label: z.string(),
    }),
  ),
});
export type SchedulePreview = z.infer<typeof schedulePreviewSchema>;
export const shiftScheduleSchema = fields.extend({
  id: z.string(),
  status: z.enum(['active', 'finished', 'cancelled']),
});
export const shiftScheduleListItemSchema = shiftScheduleSchema.extend({
  siteName: z.string(),
  guardName: z.string(),
  roundNames: z.array(z.string()),
  /** Días hasta la fecha final (negativo si ya pasó). */
  daysToEnd: z.number().int(),
  /** Turnos generados que todavía no empezaron. */
  upcomingCount: z.number().int(),
  /** Turnos generados que después se editaron a mano. */
  modifiedCount: z.number().int(),
});
export type ShiftScheduleListItem = z.infer<typeof shiftScheduleListItemSchema>;
export const shiftScheduleListSchema = z.object({
  items: z.array(shiftScheduleListItemSchema),
  /** Vigentes que terminan dentro de SCHEDULE_EXPIRING_DAYS, sin importar el filtro de estado. */
  expiring: z.number().int(),
});
export type ShiftScheduleList = z.infer<typeof shiftScheduleListSchema>;
export const scheduleOperationSchema = z.object({
  schedule: shiftScheduleSchema,
  generated: z.array(z.string()),
  replaced: z.array(z.string()),
  conserved: z.array(z.string()),
  conflicts: schedulePreviewSchema.shape.shifts,
});
export type ScheduleOperation = z.infer<typeof scheduleOperationSchema>;

/** Days use JS numbering (0 Sunday); dates include the final service day. */
export function generateScheduledShifts(
  input: ShiftScheduleInput,
  timezone: string,
): ScheduledShift[] {
  const result: ScheduledShift[] = [];
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minute(input.startTime),
    end = minute(input.endTime);
  for (let date = input.startDate; date <= input.endDate; date = scheduleDateOffset(date, 1)) {
    if (!input.weekdays.includes(new Date(`${date}T00:00:00Z`).getUTCDay())) continue;
    const startsAt = localDateTimeToUtc(date, start, timezone);
    const endDate = end <= start ? scheduleDateOffset(date, 1) : date;
    const endsAt = localDateTimeToUtc(endDate, end, timezone);
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    if (fmt.format(startsAt) !== input.startTime || fmt.format(endsAt) !== input.endTime)
      throw new RangeError('El horario local no existe por el cambio de horario de verano.');
    result.push({
      serviceDate: date,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    });
  }
  return result;
}
