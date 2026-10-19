import { evaluateTimeFlags, type DeviceClock } from '@garita/shared';

export function clockEventResponse(clock: DeviceClock | undefined, receivedAt: Date) {
  // shortcut: shift flags live in the event response, expose them through HU-16/HU-39.
  return clock
    ? {
        timeFlags: evaluateTimeFlags(clock, receivedAt).map(({ type, severity, reason }) => ({
          type,
          severity,
          reason: reason ?? null,
        })),
      }
    : {};
}

export function clockFields(clock: DeviceClock | undefined) {
  if (!clock) return {};
  return {
    trustedAt: clock.trustedAt ? new Date(clock.trustedAt) : null,
    elapsedMs: clock.elapsedMs,
    bootId: clock.bootId,
    timeStatus: clock.timeStatus,
    deviceOffsetMs: clock.trustedAt
      ? Date.parse(clock.deviceTime) - Date.parse(clock.trustedAt)
      : null,
  };
}
