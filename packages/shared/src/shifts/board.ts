import { z } from 'zod';

const isoDate = z.iso.date();

/** Lunes (YYYY-MM-DD) de la semana que contiene la fecha dada. Las fechas son de calendario, sin zona. */
export function weekStart(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - offset);
  return day.toISOString().slice(0, 10);
}

/** Suma días a una fecha de calendario (YYYY-MM-DD). */
export function addDays(date: string, days: number): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() + days);
  return day.toISOString().slice(0, 10);
}

/** Los 7 días (lunes a domingo) de la semana que contiene la fecha. */
export function weekDays(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export const shiftBoardQuerySchema = z.object({
  semana: isoDate.optional(),
  predio: z.string().min(1).optional(),
  vigilador: z.string().min(1).optional(),
});
export type ShiftBoardQuery = z.infer<typeof shiftBoardQuerySchema>;

export const shiftBoardCellSchema = z.object({
  id: z.string(),
  status: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  guard: z.object({ id: z.string(), name: z.string() }).nullable(),
  /** manual: cargado a mano · schedule: generado · modified: generado y editado después. */
  origin: z.enum(['manual', 'schedule', 'modified']),
  rounds: z.array(z.string()),
});
export type ShiftBoardCell = z.infer<typeof shiftBoardCellSchema>;

export const shiftBoardSchema = z.object({
  timezone: z.string(),
  today: isoDate,
  days: z.array(isoDate).length(7),
  sites: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      /** Un arreglo por día (lunes a domingo); un turno va en el día en que empieza. */
      days: z.array(z.array(shiftBoardCellSchema)).length(7),
    }),
  ),
  summary: z.object({
    total: z.number(),
    unassigned: z.number(),
    noShow: z.number(),
    uncovered: z.number(),
  }),
});
export type ShiftBoard = z.infer<typeof shiftBoardSchema>;
