import { ROUND_WINDOW_STATUSES } from '@garita/shared';
import { z } from 'zod';

export const shiftStatusSchema = z.enum([
  'scheduled',
  'in_progress',
  'uncovered',
  'closed',
  'auto_closed',
  'no_show',
  'without_guard',
  'unassigned',
  'cancelled',
  'cancelled_by_suspension',
]);
export const syncStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('al_dia') }),
  z.object({ status: z.literal('sincronizando'), pendingCount: z.number() }),
  z.object({ status: z.literal('sin_contacto'), since: z.string(), pendingCount: z.number() }),
  z.object({ status: z.literal('esperando_hasta'), deadline: z.string() }),
  z.object({ status: z.literal('sin_sincronizar') }),
  z.object({ status: z.literal('completo') }),
  z.object({ status: z.literal('cerrado_sin_datos') }),
]);
const siteSchema = z.object({ id: z.string(), name: z.string() });
export const shiftListSchema = z.array(
  z.object({
    id: z.string(),
    site: siteSchema,
    startsAt: z.string(),
    endsAt: z.string(),
    status: shiftStatusSchema,
    syncStatus: syncStatusSchema.nullable(),
    assignment: z
      .object({ guard: z.object({ firstName: z.string(), lastName: z.string() }).nullable() })
      .nullable(),
    windows: z.record(z.string(), z.number()),
  }),
);
const severitySchema = z.enum(['grave', 'media', 'leve']);
export const shiftDetailSchema = z.object({
  id: z.string(),
  site: siteSchema,
  status: shiftStatusSchema,
  scheduled: z.object({ startsAt: z.string(), endsAt: z.string() }),
  actual: z.object({
    startedAt: z.string().nullable(),
    closedAt: z.string().nullable(),
    closedEarly: z.boolean(),
    closeReason: z.string().nullable(),
    closedBy: z.string().nullable(),
  }),
  phoneWithoutNfc: z.boolean(),
  assignments: z.array(
    z.object({
      id: z.string(),
      startsAt: z.string(),
      endsAt: z.string(),
      isCurrent: z.boolean(),
      guard: z.object({ firstName: z.string(), lastName: z.string() }).nullable(),
    }),
  ),
  rounds: z.array(z.object({ id: z.string(), name: z.string() })),
  windows: z.array(
    z.object({
      id: z.string(),
      roundId: z.string(),
      windowIndex: z.number(),
      startsAt: z.string(),
      endsAt: z.string(),
      status: z.enum(ROUND_WINDOW_STATUSES),
      severityLevel: severitySchema.nullable(),
      recordedCount: z.number(),
      expectedCount: z.number(),
    }),
  ),
  points: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      registered: z.boolean(),
    }),
  ),
  route: z.array(
    z.object({
      checkpointId: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      occurredAtDevice: z.string(),
    }),
  ),
  records: z.array(
    z.object({
      id: z.string(),
      checkpointId: z.string(),
      occurredAtDevice: z.string(),
      flags: z.array(z.object({ id: z.string(), reason: z.string(), severity: severitySchema })),
    }),
  ),
  rejectedAttempts: z.array(
    z.object({
      id: z.string(),
      method: z.string(),
      reason: z.string(),
      occurredAtDevice: z.string(),
      highlighted: z.boolean(),
    }),
  ),
  canCover: z.boolean(),
});
export type ShiftRow = z.infer<typeof shiftListSchema>[number];
export type ShiftDetail = z.infer<typeof shiftDetailSchema>;
export type Severity = z.infer<typeof severitySchema>;

export const shiftLabels: Record<z.infer<typeof shiftStatusSchema>, string> = {
  scheduled: 'No iniciado',
  in_progress: 'En curso',
  uncovered: 'Sin cobertura',
  closed: 'Cerrado',
  auto_closed: 'Cerrado automáticamente',
  no_show: 'No presentado',
  without_guard: 'Sin vigilador',
  unassigned: 'Sin vigilador',
  cancelled: 'Cancelado',
  cancelled_by_suspension: 'Cancelado por suspensión',
};
export const windowLabels: Record<(typeof ROUND_WINDOW_STATUSES)[number], string> = {
  pending: 'Pendiente',
  in_progress: 'En curso',
  late: 'Atrasada',
  complete: 'Completa',
  complete_late: 'Completa con demora',
  incomplete: 'Incompleta',
  not_done: 'No realizada',
  pending_sync: 'Pendiente de sincronizar',
  in_review: 'En revisión',
};
export function time(value: string) {
  return new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(value));
}
export function syncLabel(value: ShiftRow['syncStatus']) {
  if (!value) return null;
  switch (value.status) {
    case 'al_dia':
      return 'Al día';
    case 'sincronizando':
      return `Sincronizando (quedan ${value.pendingCount} eventos)`;
    case 'sin_contacto':
      return `Sin contacto desde ${time(value.since)} (quedan ${value.pendingCount} eventos)`;
    case 'esperando_hasta':
      return `Esperando sincronización hasta ${time(value.deadline)}`;
    case 'sin_sincronizar':
      return 'Sin sincronizar';
    case 'completo':
      return 'Completo';
    case 'cerrado_sin_datos':
      return 'Cerrado sin datos';
  }
}
