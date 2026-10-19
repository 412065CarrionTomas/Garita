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
    link: z.string(),
  })
  .strict();

export type DeviceKind = z.infer<typeof deviceKindSchema>;
export type DevicePlatform = z.infer<typeof devicePlatformSchema>;
export type NotificationKind = z.infer<typeof notificationKindSchema>;
export type RegisterDeviceRequest = z.infer<typeof registerDeviceRequestSchema>;
export type Device = z.infer<typeof deviceSchema>;
export type NotificationPayload = z.infer<typeof notificationPayloadSchema>;
