import { z } from 'zod';

const isoDateTime = z.iso.datetime({ offset: true });

export const shiftOfflineDataSchema = z.object({
  shift: z.object({
    id: z.string().min(1),
    siteId: z.string().min(1),
    siteName: z.string().min(1),
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    timezone: z.string().min(1),
    assignmentId: z.string().min(1),
  }),
  rounds: z.array(
    z.object({
      roundId: z.string().min(1),
      roundVersionId: z.string().min(1),
      name: z.string().min(1),
      frequencyMinutes: z.number().int().positive(),
      windowStartLocal: z.string().regex(/^\d{2}:\d{2}$/),
      windowEndLocal: z.string().regex(/^\d{2}:\d{2}$/),
      graceMinutes: z.number().int().nonnegative(),
      checkpointIds: z.array(z.string()),
    }),
  ),
  windows: z.array(
    z.object({
      roundId: z.string(),
      index: z.number().int().nonnegative(),
      startUtc: isoDateTime,
      endUtc: isoDateTime,
      label: z.string(),
    }),
  ),
  checkpoints: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      qrVersion: z.number().int().positive(),
      nfcUid: z.string().nullable(),
      isIndoor: z.boolean(),
    }),
  ),
  serverTime: z.object({ serverNowUtc: isoDateTime }),
});

/** HU-10 produces this API response when a shift starts; future contract changes are additive. */
export type ShiftOfflineData = z.infer<typeof shiftOfflineDataSchema>;

export const pendingFieldEventSchema = z.object({
  id: z.uuid(),
  type: z
    .enum(['shift_start', 'shift_close', 'checkpoint_record', 'invalid_scan_attempt'])
    .or(z.string().min(1)),
  payload: z.unknown(),
  occurredAtDevice: isoDateTime,
  createdAt: isoDateTime,
});
export type PendingFieldEvent = z.infer<typeof pendingFieldEventSchema>;
