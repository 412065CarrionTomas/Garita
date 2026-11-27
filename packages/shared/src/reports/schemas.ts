import { z } from 'zod';
import { ROUND_WINDOW_STATUSES } from '../supervision/window-status';
import { localReportDay, SITE_DAY_STATUSES } from './compliance';

const id = z.string().min(1).max(100);
const day = z.iso.date();
const filters = { predio: id.optional(), cliente: id.optional(), vigilador: id.optional() };
function validPeriod(value: { desde?: string; hasta?: string }) {
  if (!value.desde || !value.hasta) return !value.desde && !value.hasta;
  const limit = new Date(`${value.desde}T00:00:00Z`);
  const startMonth = limit.getUTCMonth();
  limit.setUTCFullYear(limit.getUTCFullYear() + 1);
  if (limit.getUTCMonth() !== startMonth) limit.setUTCDate(0);
  return value.desde < value.hasta && new Date(value.hasta) <= limit;
}
const period = { desde: day.optional(), hasta: day.optional() };
export const reportQuerySchema = z
  .object({ ...period, ...filters })
  .strict()
  .refine(validPeriod, {
    message: 'Ingresá inicio y fin, en orden y con un período de hasta 12 meses.',
  });
export const reportDetailQuerySchema = z
  .object({
    ...period,
    ...filters,
    estado: z.enum(ROUND_WINDOW_STATUSES).optional(),
    dia: day.optional(),
    orden: z.enum(['asc', 'desc']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict()
  .refine(validPeriod, { message: 'Período inválido: máximo 12 meses e inicio anterior al fin.' });
export const reportPendingQuerySchema = z.object({ predio: id.optional() }).strict();
export const reportPointsQuerySchema = z
  .object({ ...period, predio: id.optional() })
  .strict()
  .refine(validPeriod, { message: 'Período inválido: máximo 12 meses e inicio anterior al fin.' });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportDetailQuery = z.infer<typeof reportDetailQuerySchema>;
export function defaultReportPeriod(now: Date, timezone: string) {
  const hasta = localReportDay(now, timezone);
  const end = new Date(`${hasta}T00:00:00Z`);
  const dayOfMonth = end.getUTCDate();
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() - 1);
  const lastDay = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() + 1, 0)).getUTCDate();
  end.setUTCDate(Math.min(dayOfMonth, lastDay));
  return { desde: end.toISOString().slice(0, 10), hasta };
}
const count = z.number().int().nonnegative();
export const complianceTotalsSchema = z.object({
  complete: count,
  incomplete: count,
  not_done: count,
  in_review: count,
  pending_sync: count,
  complete_late: count,
  withoutObservations: count,
  media: count,
  leve: count,
  validated: count,
  evaluated: count,
  percentage: z.number().min(0).max(100).nullable(),
});
const named = z.object({ id: z.string(), name: z.string() });
const group = named.extend({ totals: complianceTotalsSchema });
export const reportResponseSchema = z.object({
  desde: day,
  hasta: day,
  timezone: z.string(),
  totals: complianceTotalsSchema,
  daily: z.array(group),
  bySite: z.array(group),
  byGuard: z.array(group.extend({ id: z.string().nullable(), deactivated: z.boolean() })),
  filters: z.object({ sites: z.array(named), clients: z.array(named), guards: z.array(named) }),
});
export type ComplianceReport = z.infer<typeof reportResponseSchema>;
export const reportDetailResponseSchema = z.object({
  total: count,
  page: count,
  pageSize: count,
  items: z.array(
    z.object({
      id: z.string(),
      shiftId: z.string(),
      roundName: z.string(),
      site: named,
      guard: named.extend({ deactivated: z.boolean() }).nullable(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      status: z.enum(ROUND_WINDOW_STATUSES),
    }),
  ),
});
const pendingItem = z.object({ count, oldestAt: z.iso.datetime().nullable() });
export const reportPendingResponseSchema = z.object({
  inReview: pendingItem,
  incidents: pendingItem,
  unsynced: pendingItem,
  unassigned: z.object({ count, nextAt: z.iso.datetime().nullable() }),
  message: z.string(),
});
export const reportPointsResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      site: named,
      validRecords: count,
      markedRecords: count,
      proportion: z.number().min(0).max(1),
      guardCount: count,
      distribution: z.enum(['concentrated', 'distributed']),
    }),
  ),
});

/** Casilleros predio × día: como mucho 31 días, para acotar el tamaño de la respuesta. */
export const SITE_DAY_GRID_MAX_DAYS = 31;
export const siteDayGridQuerySchema = z
  .object({ desde: day, hasta: day, predio: id.optional(), cliente: id.optional() })
  .strict()
  .refine(
    ({ desde, hasta }) => {
      const days =
        (Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / 86_400_000;
      return days >= 1 && days <= SITE_DAY_GRID_MAX_DAYS;
    },
    { message: `Ingresá un período en orden y de hasta ${SITE_DAY_GRID_MAX_DAYS} días.` },
  );
export type SiteDayGridQuery = z.infer<typeof siteDayGridQuerySchema>;
export const siteDayGridResponseSchema = z.object({
  desde: day,
  hasta: day,
  timezone: z.string(),
  days: z.array(day),
  sites: z.array(
    named.extend({
      cells: z.array(
        z.object({
          day,
          status: z.enum(SITE_DAY_STATUSES),
          evaluated: count,
          percentage: z.number().min(0).max(100).nullable(),
        }),
      ),
    }),
  ),
});
export type SiteDayGrid = z.infer<typeof siteDayGridResponseSchema>;
