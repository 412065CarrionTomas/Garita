import { z } from 'zod';
import { INCIDENT_TYPES, INCIDENT_TYPE_LABELS } from '../incidents';
import { reportQuerySchema } from './schemas';

export const incidentReportQuerySchema = z
  .object({
    desde: reportQuerySchema.shape.desde,
    hasta: reportQuerySchema.shape.hasta,
    predio: reportQuerySchema.shape.predio,
    cliente: reportQuerySchema.shape.cliente,
  })
  .strict()
  .refine(
    ({ desde, hasta, predio, cliente }) =>
      reportQuerySchema.safeParse({ desde, hasta, predio, cliente }).success,
    { message: 'Período inválido: máximo 12 meses e inicio anterior al fin.' },
  );
export const incidentReportDetailQuerySchema = incidentReportQuerySchema.safeExtend({
  tipo: z.enum(INCIDENT_TYPES).optional(),
  franja: z.coerce.number().int().min(0).max(22).multipleOf(2).optional(),
  clasificacion: z.enum(['pending', 'client_visible', 'internal']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export const panicReportDetailQuerySchema = incidentReportQuerySchema.safeExtend({
  resultado: z.enum(['real_emergency', 'false_alarm', 'test', 'unresolved']).optional(),
  canal: z.enum(['internet', 'sms']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export type IncidentReportQuery = z.infer<typeof incidentReportQuerySchema>;
export type IncidentReportDetailQuery = z.infer<typeof incidentReportDetailQuerySchema>;
export type PanicReportDetailQuery = z.infer<typeof panicReportDetailQuerySchema>;
const count = z.number().int().nonnegative();
const named = z.object({ id: z.string(), name: z.string() });
const group = named.extend({ value: count });
const period = { desde: z.iso.date(), hasta: z.iso.date(), timezone: z.string() };
export const incidentReportResponseSchema = z.object({
  ...period,
  total: count,
  byType: z.array(group),
  byTimeBand: z.array(group),
  bySite: z.array(group),
  byClassification: z.array(group),
  pending: z.object({
    count,
    oldestAt: z.iso.datetime().nullable(),
    oldestAgeMs: z.number().nonnegative().nullable(),
  }),
  filters: z.object({ sites: z.array(named), clients: z.array(named) }),
});
export const responseTimeSummarySchema = z.object({
  count,
  averageMs: z.number().nonnegative().nullable(),
  maximumMs: z.number().nonnegative().nullable(),
  unanswered: count,
  escalated: count,
});
const times = z.object({
  panic: responseTimeSummarySchema,
  missedRound: responseTimeSummarySchema,
  classification: responseTimeSummarySchema,
});
const timedGroup = named.extend({ times });
const responseBase = z.object({ ...period, totals: times, bySite: z.array(timedGroup) });
export const responseTimesReportSchema = z.union([
  responseBase.extend({ bySupervisor: z.array(timedGroup) }).strict(),
  responseBase.extend({ own: timedGroup }).strict(),
]);
export const panicReportResponseSchema = z.object({
  ...period,
  total: count,
  byOutcome: z.array(group),
  byChannel: z.array(group),
  falseAlarmProportion: z.number().min(0).max(1).nullable(),
});
const detailBase = { total: count, page: count, pageSize: count };
export const incidentReportDetailResponseSchema = z.object({
  ...detailBase,
  items: z.array(
    z.object({
      id: z.string(),
      site: named,
      type: z.enum(INCIDENT_TYPES),
      classificationStatus: z.enum(['pending', 'client_visible', 'internal']),
      occurredAt: z.iso.datetime(),
    }),
  ),
});
export const panicReportDetailResponseSchema = z.object({
  ...detailBase,
  items: z.array(
    z.object({
      id: z.string(),
      site: named,
      triggeredAt: z.iso.datetime(),
      channel: z.enum(['internet', 'sms']),
      outcome: z.enum(['real_emergency', 'false_alarm', 'test']).nullable(),
    }),
  ),
});
export type IncidentReportDetailData = z.infer<typeof incidentReportDetailResponseSchema>;
export type PanicReportDetailData = z.infer<typeof panicReportDetailResponseSchema>;
export type IncidentReportData = z.infer<typeof incidentReportResponseSchema>;
export type ResponseTimesReport = z.infer<typeof responseTimesReportSchema>;
export type ResponseTimeSummary = z.infer<typeof responseTimeSummarySchema>;
type Named = z.infer<typeof named>;
type Instant = string | Date;
interface IncidentSource {
  type: (typeof INCIDENT_TYPES)[number];
  classificationStatus: 'pending' | 'client_visible' | 'internal';
  site: Named;
  trustedAt: Instant | null;
  occurredAtDevice: Instant;
  receivedAt: Instant;
}

export function incidentTimeBand(at: Instant, timezone: string): number {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(at)),
  );
  return Math.floor(hour / 2) * 2;
}
export function computeIncidentReport(
  rows: readonly IncidentSource[],
  timezone: string,
  now: Date,
) {
  const byType = INCIDENT_TYPES.map((id) => ({ id, name: INCIDENT_TYPE_LABELS[id], value: 0 }));
  const byTimeBand = Array.from({ length: 12 }, (_, i) => ({
    id: String(i * 2),
    name: `${String(i * 2).padStart(2, '0')}:00–${String(i * 2 + 2).padStart(2, '0')}:00`,
    value: 0,
  }));
  const byClassification = [
    { id: 'client_visible', name: 'Visibles para el cliente', value: 0 },
    { id: 'internal', name: 'Internos', value: 0 },
    { id: 'pending', name: 'Pendientes de clasificar', value: 0 },
  ];
  const sites = new Map<string, Named & { value: number }>();
  let oldest: number | null = null;
  let pending = 0;
  for (const row of rows) {
    const type = byType.find((group) => group.id === row.type);
    if (type) type.value++;
    const band = byTimeBand[incidentTimeBand(row.trustedAt ?? row.occurredAtDevice, timezone) / 2];
    if (band) band.value++;
    const classification = byClassification.find((group) => group.id === row.classificationStatus);
    if (classification) classification.value++;
    const site = sites.get(row.site.id) ?? { ...row.site, value: 0 };
    site.value++;
    sites.set(site.id, site);
    if (row.classificationStatus === 'pending') {
      pending++;
      oldest = Math.min(oldest ?? Infinity, new Date(row.receivedAt).getTime());
    }
  }
  return {
    total: rows.length,
    byType,
    byTimeBand,
    bySite: [...sites.values()],
    byClassification,
    pending: {
      count: pending,
      oldestAt: oldest === null ? null : new Date(oldest).toISOString(),
      oldestAgeMs: oldest === null ? null : Math.max(0, now.getTime() - oldest),
    },
  };
}
export interface ResponseSample {
  startedAt: Instant;
  respondedAt: Instant | null;
  escalated?: boolean;
}
export function summarizeResponseTimes(rows: readonly ResponseSample[]): ResponseTimeSummary {
  let sum = 0;
  let maximumMs: number | null = null;
  let count = 0;
  let unanswered = 0;
  let escalated = 0;
  for (const row of rows) {
    if (row.escalated) escalated++;
    if (row.respondedAt === null) {
      unanswered++;
      continue;
    }
    const duration = Math.max(
      0,
      new Date(row.respondedAt).getTime() - new Date(row.startedAt).getTime(),
    );
    count++;
    sum += duration;
    maximumMs = Math.max(maximumMs ?? 0, duration);
  }
  return { count, averageMs: count ? sum / count : null, maximumMs, unanswered, escalated };
}
interface Response {
  at: Instant;
  by: Named;
}
export function firstResponse(rows: readonly Response[]): Response | null {
  return rows.reduce<Response | null>(
    (first, row) => (!first || new Date(row.at) < new Date(first.at) ? row : first),
    null,
  );
}
interface PanicTimeSource {
  site: Named;
  triggeredAt: Instant;
  confirmedAt: Instant | null;
  confirmedBy: Named | null;
  escalatedAt: Instant | null;
}
interface DecisionTimeSource {
  site: Named;
  startedAt: Instant;
  responses: readonly Response[];
}
export function computeResponseTimes(
  panics: readonly PanicTimeSource[],
  notices: readonly DecisionTimeSource[],
  incidents: readonly DecisionTimeSource[],
) {
  type Sample = ResponseSample & {
    site: Named;
    by: Named | null;
    kind: 'panic' | 'missedRound' | 'classification';
  };
  const samples: Sample[] = panics.map((row) => ({
    site: row.site,
    by: row.confirmedBy,
    kind: 'panic',
    startedAt: row.triggeredAt,
    respondedAt: row.confirmedAt,
    escalated: row.escalatedAt !== null,
  }));
  for (const [kind, rows] of [
    ['missedRound', notices],
    ['classification', incidents],
  ] as const) {
    for (const row of rows) {
      const first = firstResponse(row.responses);
      samples.push({
        site: row.site,
        by: first?.by ?? null,
        kind,
        startedAt: row.startedAt,
        respondedAt: first?.at ?? null,
      });
    }
  }
  const summarize = (rows: readonly Sample[]) => ({
    panic: summarizeResponseTimes(rows.filter((row) => row.kind === 'panic')),
    missedRound: summarizeResponseTimes(rows.filter((row) => row.kind === 'missedRound')),
    classification: summarizeResponseTimes(rows.filter((row) => row.kind === 'classification')),
  });
  const grouped = (key: 'site' | 'by') => {
    const groups = new Map<string, { person: Named; rows: Sample[] }>();
    for (const row of samples) {
      const person = row[key];
      if (!person) continue;
      const group = groups.get(person.id) ?? { person, rows: [] };
      group.rows.push(row);
      groups.set(person.id, group);
    }
    return [...groups.values()].map((group) => ({ ...group.person, times: summarize(group.rows) }));
  };
  return { totals: summarize(samples), bySite: grouped('site'), bySupervisor: grouped('by') };
}
export function computePanicReport(
  rows: readonly {
    outcome: 'real_emergency' | 'false_alarm' | 'test' | null;
    channel: 'internet' | 'sms';
  }[],
) {
  const byOutcome = [
    { id: 'real_emergency', name: 'Emergencia real', value: 0 },
    { id: 'false_alarm', name: 'Falsa alarma', value: 0 },
    { id: 'test', name: 'Prueba', value: 0 },
    { id: 'unresolved', name: 'Sin resolver', value: 0 },
  ];
  const byChannel = [
    { id: 'internet', name: 'Internet', value: 0 },
    { id: 'sms', name: 'SMS', value: 0 },
  ];
  for (const row of rows) {
    const outcome = byOutcome.find((group) => group.id === (row.outcome ?? 'unresolved'));
    if (outcome) outcome.value++;
    const channel = byChannel.find((group) => group.id === row.channel);
    if (channel) channel.value++;
  }
  return {
    total: rows.length,
    byOutcome,
    byChannel,
    falseAlarmProportion: rows.length
      ? rows.filter((row) => row.outcome === 'false_alarm').length / rows.length
      : null,
  };
}
