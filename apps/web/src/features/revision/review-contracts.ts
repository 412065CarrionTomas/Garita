import {
  FLAG_SEVERITY,
  recordFlagSeveritySchema,
  recordFlagTypeSchema,
  RECORD_FLAG_LABELS,
} from '@garita/shared';
import { z } from 'zod';

export type Severity = z.infer<typeof recordFlagSeveritySchema>;
const date = z.coerce.date();
const decisionKind = z.enum(['validate', 'invalidate', 'restore']);

export const queueSchema = z.object({
  timezone: z.string(),
  count: z.number(),
  overdue: z.number(),
  resolvedLastDay: z.number(),
  /** Hay más de las que vinieron: conviene acotar con fechas o predio. */
  truncated: z.boolean(),
  items: z.array(
    z.object({
      id: z.string(),
      status: z.string(),
      severityLevel: recordFlagSeveritySchema.nullable(),
      startsAt: date,
      endsAt: date,
      inReviewSince: date.nullable(),
      windowIndex: z.number(),
      recordedCount: z.number(),
      expectedCount: z.number(),
      overdue: z.boolean(),
      shift: z.object({ id: z.string(), site: z.object({ id: z.string(), name: z.string() }) }),
      round: z.object({ name: z.string() }),
      guardName: z.string().nullable(),
      flags: z.object({
        grave: z.number(),
        media: z.number(),
        leve: z.number(),
        // Un tipo nuevo de la API no rompe la bandeja: se muestra tal cual.
        types: z.array(z.string()),
      }),
      resolution: z
        .object({ kind: decisionKind, decidedAt: date, decidedBy: z.string(), comment: z.string() })
        .nullable(),
    }),
  ),
});
export type Queue = z.infer<typeof queueSchema>;
export type QueueItem = Queue['items'][number];

export const detailSchema = z.object({
  id: z.string(),
  shiftId: z.string(),
  siteName: z.string(),
  roundName: z.string(),
  timezone: z.string(),
  status: z.string(),
  severityLevel: recordFlagSeveritySchema.nullable(),
  startsAt: date,
  endsAt: date,
  inReviewSince: date.nullable(),
  windowIndex: z.number(),
  recordedCount: z.number(),
  expectedCount: z.number(),
  guardName: z.string().nullable(),
  guardHistory: z
    .object({
      days: z.number(),
      records: z.number(),
      graveFlags: z.number(),
      invalidatedRecords: z.number(),
    })
    .nullable(),
  records: z.array(
    z.object({
      id: z.string(),
      checkpointName: z.string(),
      occurredAtDevice: date,
      invalidated: z.boolean(),
      method: z.enum(['qr', 'nfc']),
      radiusMeters: z.number(),
      accuracyMeters: z.number().nullable(),
      distanceMeters: z.number().nullable(),
      flags: z.array(
        z.object({
          type: z.string(),
          severity: recordFlagSeveritySchema,
          reason: z.string().nullable(),
          /** Los valores con que se generó la marca (distancia, intervalo, velocidad…). */
          details: z.record(z.string(), z.unknown()).nullable(),
        }),
      ),
    }),
  ),
  decisions: z.array(
    z.object({
      id: z.string(),
      kind: decisionKind,
      checkpointRecordId: z.string().nullable(),
      comment: z.string(),
      decidedAt: date,
      decidedBy: z.string(),
    }),
  ),
});
export type Detail = z.infer<typeof detailSchema>;
export type ReviewRecord = Detail['records'][number];

export const countSchema = z.object({ count: z.number() });
export const sitesSchema = z.array(z.looseObject({ id: z.string(), name: z.string() }));

export const commentSchema = z.object({ comment: z.string().trim().min(5).max(500) });

export const SEVERITY_LABELS: Record<Severity, string> = {
  grave: 'Grave',
  media: 'Media',
  leve: 'Leve',
};
export const SEVERITY_ORDER: Record<Severity, number> = { grave: 0, media: 1, leve: 2 };

export const DECISION_LABELS: Record<z.infer<typeof decisionKind>, string> = {
  validate: 'Validó la ventana',
  invalidate: 'Invalidó un registro',
  restore: 'Restituyó un registro',
};

export const STATUS_LABELS: Record<string, string> = {
  in_review: 'En revisión',
  complete: 'Completa',
  complete_late: 'Completa con demora',
  incomplete: 'Incompleta',
  not_done: 'No realizada',
  late: 'Demorada',
  in_progress: 'En curso',
  pending: 'Pendiente',
  pending_sync: 'Esperando sincronización',
};

/** Gravedad de un tipo de marca (la bandeja solo trae los tipos); uno desconocido cuenta como leve. */
export function flagSeverity(type: string): Severity {
  const parsed = recordFlagTypeSchema.safeParse(type);
  return parsed.success ? FLAG_SEVERITY[parsed.data] : 'leve';
}

export function flagLabel(type: string) {
  const parsed = recordFlagTypeSchema.safeParse(type);
  return parsed.success ? RECORD_FLAG_LABELS[parsed.data] : { label: type, meaning: '' };
}

/** "34 h", "12 min", "3 d": tiempo transcurrido corto para la columna de espera. */
export function elapsed(from: Date, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - from.getTime()) / 60_000));
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${String(hours)} h` : `${String(Math.floor(hours / 24))} d`;
}

/** "4 min 20 s" o "45 s": tiempo entre dos lecturas. */
export function gap(seconds: number) {
  if (seconds < 60) return `${String(seconds)} s`;
  const pair = (big: number, bigUnit: string, small: number, smallUnit: string) =>
    small ? `${String(big)} ${bigUnit} ${String(small)} ${smallUnit}` : `${String(big)} ${bigUnit}`;
  if (seconds < 3600) return pair(Math.floor(seconds / 60), 'min', seconds % 60, 's');
  if (seconds < 86_400)
    return pair(Math.floor(seconds / 3600), 'h', Math.floor((seconds % 3600) / 60), 'min');
  return pair(Math.floor(seconds / 86_400), 'd', Math.floor((seconds % 86_400) / 3600), 'h');
}

export const dayTime = (value: Date, timeZone: string) =>
  value.toLocaleString('es-AR', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });

export const clock = (value: Date, timeZone: string, seconds = false) =>
  value.toLocaleTimeString('es-AR', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
    hourCycle: 'h23',
  });
