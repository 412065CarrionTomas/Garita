import { z } from 'zod';

export const DEVICE_KINDS = ['web', 'app'] as const;
export const DEVICE_PLATFORMS = ['android', 'ios', 'web'] as const;

export const NOTIFICATION_KINDS = [
  // Emitted in Sprint 3: HU-19, HU-39 and HU-45.
  'incident_new',
  'round_in_review',
  'shift_assigned',
  'shift_changed',
  'shift_reassigned_to_you',
  'shift_removed',
  'shift_cancelled',
  'shift_closed_site_removed',
  'shift_reassigned_from_you',
  'shift_schedule_summary',
  // Reserved for HU-17 and HU-35.
  'round_missed',
  'shift_unsynced',
  'shift_not_started',
  'shift_closed_early',
  'shift_without_guard',
  // Reserved for E5.
  'panic',
] as const;

export const deviceKindSchema = z.enum(DEVICE_KINDS);
export const devicePlatformSchema = z.enum(DEVICE_PLATFORMS);
export const notificationKindSchema = z.enum(NOTIFICATION_KINDS);

export const registerDeviceRequestSchema = z.object({
  token: z.string().min(1).max(4096),
  kind: deviceKindSchema,
  platform: devicePlatformSchema,
  label: z.string().max(80).optional(),
});

export const deviceSchema = z.object({
  id: z.string(),
  kind: deviceKindSchema,
  platform: devicePlatformSchema,
  label: z.string().nullable(),
  createdAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime(),
});

/** Minimum content required by HU-18 and HU-45: never people's names or addresses. */
export const notificationPayloadSchema = z
  .object({
    kind: notificationKindSchema,
    siteName: z.string().optional(),
    day: z.string().optional(),
    time: z.string().optional(),
    body: z.string().optional(),
    link: z.string(),
  })
  .strict();

export type DeviceKind = z.infer<typeof deviceKindSchema>;
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;

type ShiftChange =
  | {
      kind:
        | 'shift_assigned'
        | 'shift_changed'
        | 'shift_reassigned_to_you'
        | 'shift_reassigned_from_you'
        | 'shift_removed'
        | 'shift_cancelled'
        | 'shift_closed_site_removed';
      shiftId: string;
      startsAt: Date;
      timezone: string;
      now?: Date;
    }
  | { kind: 'shift_schedule_summary'; count: number; from: Date; to: Date; timezone: string };

export function buildShiftNotification(change: ShiftChange) {
  // TODO(HU-32): emit the schedule summary when weekly scheduling exists.
  if (change.kind === 'shift_schedule_summary') {
    const day = (date: Date) =>
      new Intl.DateTimeFormat('es-AR', { day: 'numeric', timeZone: change.timezone }).format(date);
    const month = new Intl.DateTimeFormat('es-AR', {
      month: 'long',
      timeZone: change.timezone,
    }).format(change.to);
    return {
      kind: change.kind,
      payload: {
        kind: change.kind,
        link: '/mis-turnos',
        body: `Te programaron ${change.count} turnos del ${day(change.from)} al ${day(change.to)} de ${month}`,
      },
      body: `Te programaron ${change.count} turnos del ${day(change.from)} al ${day(change.to)} de ${month}`,
      priority: 'normal' as const,
    };
  }
  const day = new Intl.DateTimeFormat('es-AR', {
    weekday: 'long',
    timeZone: change.timezone,
  }).format(change.startsAt);
  const time = new Intl.DateTimeFormat('es-AR', {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZone: change.timezone,
  }).format(change.startsAt);
  const labels = {
    shift_assigned: 'Te asignaron un turno',
    shift_changed: 'Cambió el horario de tu turno',
    shift_reassigned_to_you: 'Te asignaron un turno',
    shift_reassigned_from_you: 'Tu turno fue reasignado',
    shift_removed: 'Te quitaron un turno',
    shift_cancelled: 'Se canceló tu turno',
    shift_closed_site_removed: 'Tu turno terminó por la baja del predio',
  };
  return {
    kind: change.kind,
    payload: {
      kind: change.kind,
      day,
      time,
      link: `/turno/${change.shiftId}`,
      body: `${labels[change.kind]} del ${day} a las ${time}`,
    },
    body: `${labels[change.kind]} del ${day} a las ${time}`,
    priority:
      (change.kind === 'shift_reassigned_to_you' || change.kind === 'shift_reassigned_from_you') &&
      change.startsAt.getTime() - (change.now ?? new Date()).getTime() < 2 * 60 * 60 * 1000
        ? ('high' as const)
        : ('normal' as const),
  };
}
