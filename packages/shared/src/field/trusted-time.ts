import { z } from 'zod';

const iso = z.iso.datetime({ offset: true });
export const monotonicClockSchema = z.object({
  elapsedMs: z.number().int().nonnegative(),
  bootId: z.string().min(1).max(128),
});
export type MonotonicClock = z.infer<typeof monotonicClockSchema>;
export const deviceClockSchema = monotonicClockSchema.extend({
  deviceTime: iso,
  trustedAt: iso.nullable(),
  timeStatus: z.enum(['verified', 'recalculated', 'pending', 'unverifiable']),
  referenceOffsetMs: z.number().int().nullable(),
});
export type DeviceClock = z.infer<typeof deviceClockSchema>;
export const timeReferenceSchema = monotonicClockSchema.extend({
  serverTime: iso,
  offsetMs: z.number().int(),
});
export type TimeReference = z.infer<typeof timeReferenceSchema>;
export const serverTimeResponseSchema = z.object({ serverTime: iso });

export function trustedTimeFor(
  event: MonotonicClock & { deviceTime: string },
  reference: TimeReference | null,
): DeviceClock {
  const sameBoot = reference !== null && event.bootId === reference.bootId;
  return {
    ...event,
    trustedAt: sameBoot
      ? new Date(
          Date.parse(reference.serverTime) + event.elapsedMs - reference.elapsedMs,
        ).toISOString()
      : null,
    timeStatus: sameBoot ? 'verified' : 'pending',
    referenceOffsetMs: reference?.offsetMs ?? null,
  };
}

export function isTimeAltered(eventOffsetMs: number, referenceOffsetMs: number): boolean {
  return Math.abs(eventOffsetMs - referenceOffsetMs) > 120_000;
}

/** Keep the old offset: refreshing the baseline must not hide a change made while offline. */
export function recalculateBoot(
  events: readonly DeviceClock[],
  reference: TimeReference,
): DeviceClock[] {
  return events.map((event) => {
    if (event.timeStatus !== 'pending') return event;
    if (event.bootId !== reference.bootId) return { ...event, timeStatus: 'unverifiable' };
    return {
      ...trustedTimeFor(event, reference),
      timeStatus: 'recalculated',
      referenceOffsetMs: event.referenceOffsetMs ?? reference.offsetMs,
    };
  });
}
