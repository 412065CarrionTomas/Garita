import { z } from 'zod';
import { computeCompliance, type ComplianceTotals } from './reports/compliance';
import { reportPointsQuerySchema } from './reports/schemas';
import type { RoundWindowStatus } from './supervision/window-status';
import { INCIDENT_TYPES } from './incidents';

export const PORTAL_STATUS_LABELS = {
  completa: 'Completa',
  incompleta: 'Incompleta',
  no_realizada: 'No realizada',
  en_verificacion: 'En verificación',
} as const;
export const PORTAL_VERIFICATION_MESSAGE =
  'El porcentaje se actualiza cuando la empresa termina de verificarlas';
export function portalRoundStatus(status: RoundWindowStatus) {
  switch (status) {
    case 'complete':
    case 'complete_late':
      return 'completa';
    case 'incomplete':
      return 'incompleta';
    case 'not_done':
      return 'no_realizada';
    case 'in_review':
      return 'en_verificacion';
    default:
      return null;
  }
}
export const portalQuerySchema = reportPointsQuerySchema;
const pagination = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
};
export const portalListQuerySchema = portalQuerySchema.safeExtend(pagination);
export const portalDayQuerySchema = z.strictObject({
  fecha: z.iso.date(),
  predio: z.string().min(1).max(100).optional(),
  ...pagination,
});
export type PortalQuery = z.infer<typeof portalQuerySchema>;
export type PortalListQuery = z.infer<typeof portalListQuerySchema>;
export type PortalDayQuery = z.infer<typeof portalDayQuerySchema>;
const count = z.number().int().nonnegative();
const named = z.strictObject({ id: z.string(), name: z.string() });
export const portalSitesSchema = z.array(named);
const totals = z.strictObject({
  completa: count,
  incompleta: count,
  no_realizada: count,
  en_verificacion: count,
  evaluated: count,
  percentage: z.number().min(0).max(100).nullable(),
});
function portalTotals(value: ComplianceTotals) {
  return {
    completa: value.complete,
    incompleta: value.incomplete,
    no_realizada: value.not_done,
    en_verificacion: value.in_review,
    evaluated: value.evaluated,
    percentage: value.percentage,
  };
}
export interface PortalWindow {
  status: RoundWindowStatus;
  startsAt: string;
  endsAt: string;
  site: { id: string; name: string };
}
// La fórmula es HU-25; no se cargan identidades, observaciones ni asignaciones para calcularla.
export function computePortalCompliance(
  windows: readonly PortalWindow[],
  timezone: string,
  period: { desde: string; hasta: string },
) {
  const result = computeCompliance(
    windows
      .filter((window) => portalRoundStatus(window.status) !== null)
      .map((window) => ({
        ...window,
        severityLevel: null,
        shiftStatus: 'closed',
        assignments: [],
      })),
    timezone,
    period,
  );
  return {
    ...period,
    timezone,
    totals: portalTotals(result.totals),
    daily: result.daily.map((day) => ({ date: day.id, totals: portalTotals(day.totals) })),
    verificationMessage: PORTAL_VERIFICATION_MESSAGE,
  };
}
export const portalRoundsSchema = z.strictObject({
  desde: z.iso.date(),
  hasta: z.iso.date(),
  timezone: z.string(),
  totals,
  daily: z.array(z.strictObject({ date: z.iso.date(), totals })),
  verificationMessage: z.literal(PORTAL_VERIFICATION_MESSAGE),
});
export type PortalRounds = z.infer<typeof portalRoundsSchema>;
const page = { total: count, page: count, pageSize: count };
export const portalDaySchema = z.strictObject({
  ...page,
  items: z.array(
    z.strictObject({
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      site: named,
      status: z.enum(['completa', 'incompleta', 'no_realizada', 'en_verificacion']),
    }),
  ),
});
export const portalIncidentsSchema = z.strictObject({
  ...page,
  items: z.array(
    z.strictObject({
      id: z.string(),
      type: z.enum(INCIDENT_TYPES),
      occurredAt: z.iso.datetime(),
      site: named,
      clientNote: z.string().nullable(),
      photoCount: count,
    }),
  ),
});
export const portalPhotosSchema = z.array(
  z.strictObject({
    thumbnailUrl: z.url(),
    fullUrl: z.url(),
  }),
);
export const portalEmergenciesSchema = z.strictObject({
  ...page,
  items: z.array(
    z.strictObject({
      triggeredAt: z.iso.datetime(),
      site: named,
      responseTimeMs: z.number().nonnegative(),
    }),
  ),
});
