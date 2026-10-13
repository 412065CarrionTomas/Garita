import { z } from 'zod';
import { shiftOfflineDataSchema } from './shift-offline-data';

/**
 * HU-10 contract between the API (start, close and state of a shift) and the guard app.
 * Both sides import these schemas; changes must be additive.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** Minutes before the scheduled start from which a shift can be started (HU-34 will make it per site). */
export const SHIFT_START_MARGIN_MINUTES = 30;
/** Minutes after the scheduled end at which the server auto-closes a shift (HU-34 may extend it). */
export const SHIFT_AUTO_CLOSE_AFTER_MINUTES = 120;

/** Execution states that HU-10 adds to the shift lifecycle. */
export const SHIFT_EXECUTION_STATUSES = ['in_progress', 'closed', 'auto_closed'] as const;
export type ShiftExecutionStatus = (typeof SHIFT_EXECUTION_STATUSES)[number];

/** Who closed a shift. */
export const SHIFT_CLOSED_BY = ['guard', 'admin', 'system'] as const;
export type ShiftClosedBy = (typeof SHIFT_CLOSED_BY)[number];

/** Error codes returned in the `code` field of 4xx responses of the shift execution endpoints. */
export const SHIFT_EXECUTION_ERROR_CODES = {
  /** 409: the current assignment belongs to another guard (HU-44). */
  reassigned: 'SHIFT_REASSIGNED',
  /** 409: the guard already has a shift in progress. */
  anotherInProgress: 'ANOTHER_SHIFT_IN_PROGRESS',
  /** 409: the shift is cancelled, closed or auto-closed. */
  notStartable: 'SHIFT_NOT_STARTABLE',
  /** 422: outside the start margin (earlier than 30 min before start, or after the end). */
  outsideStartMargin: 'OUTSIDE_START_MARGIN',
  /** 403: the guard has not activated the invitation yet. */
  invitationPending: 'INVITATION_PENDING',
  /** 409: the shift is not in progress, so it cannot be closed. */
  notInProgress: 'SHIFT_NOT_IN_PROGRESS',
  /** 400: closing before the scheduled end requires a reason. */
  earlyCloseReasonRequired: 'EARLY_CLOSE_REASON_REQUIRED',
  /** 409: deactivating a guard with a shift in progress requires `forceDeactivate` and a reason. */
  guardHasShiftInProgress: 'GUARD_HAS_SHIFT_IN_PROGRESS',
} as const;
export type ShiftExecutionErrorCode =
  (typeof SHIFT_EXECUTION_ERROR_CODES)[keyof typeof SHIFT_EXECUTION_ERROR_CODES];

/** A location reading taken by the app at a field event. */
export const fieldLocationSchema = z.object({
  /** `ok`: reading obtained; `unverifiable`: location on but no fix in time; `disabled`: off, denied or approximate. */
  status: z.enum(['ok', 'unverifiable', 'disabled']),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  accuracyMeters: z.number().nonnegative().nullable(),
  /** Result of the native module (HU-15); `unavailable` when it cannot tell. */
  simulation: z.enum(['simulated', 'not_simulated', 'unavailable']),
  takenAt: isoDateTime.nullable(),
});
export type FieldLocation = z.infer<typeof fieldLocationSchema>;

/** Body of `POST /turnos/:id/iniciar`. The event id is generated on the phone (HU-13 reuses it). */
export const startShiftRequestSchema = z.object({
  eventId: z.uuid(),
  occurredAtDevice: isoDateTime,
  location: fieldLocationSchema,
});
export type StartShiftRequest = z.infer<typeof startShiftRequestSchema>;

/** Response of `POST /turnos/:id/iniciar` (also returned when the same eventId is sent again). */
export const startShiftResponseSchema = z.object({
  status: z.literal('in_progress'),
  startedAt: isoDateTime,
  /** Minutes late against the assignment start; `null` when it started on time. */
  lateStartMinutes: z.number().int().positive().nullable(),
  /** Everything the app needs to work without signal (contract of PR #15). */
  data: shiftOfflineDataSchema,
});
export type StartShiftResponse = z.infer<typeof startShiftResponseSchema>;

/** Body of `POST /turnos/:id/cerrar`. `reason` is required when closing before the scheduled end. */
export const closeShiftRequestSchema = z.object({
  eventId: z.uuid(),
  occurredAtDevice: isoDateTime,
  location: fieldLocationSchema,
  reason: z.string().trim().min(3).max(500).optional(),
});
export type CloseShiftRequest = z.infer<typeof closeShiftRequestSchema>;

/** Response of `POST /turnos/:id/cerrar`. */
export const closeShiftResponseSchema = z.object({
  status: z.literal('closed'),
  closedAt: isoDateTime,
  closedEarly: z.boolean(),
});
export type CloseShiftResponse = z.infer<typeof closeShiftResponseSchema>;

/** Response of `GET /turnos/:id/estado`: current window of each round and its pending points, in order. */
export const shiftStateResponseSchema = z.object({
  status: z.enum(['scheduled', 'unassigned', 'cancelled', ...SHIFT_EXECUTION_STATUSES]),
  rounds: z.array(
    z.object({
      roundId: z.string(),
      currentWindow: z
        .object({
          index: z.number().int().nonnegative(),
          startUtc: isoDateTime,
          endUtc: isoDateTime,
          label: z.string(),
        })
        .nullable(),
      pendingCheckpointIds: z.array(z.string()),
    }),
  ),
});
export type ShiftStateResponse = z.infer<typeof shiftStateResponseSchema>;

/** `true` when closing at `closingAt` happens before the scheduled end, so a reason is required. */
export function isEarlyClose(scheduledEndUtc: string, closingAtUtc: string): boolean {
  return Date.parse(closingAtUtc) < Date.parse(scheduledEndUtc);
}

/** `true` when `nowUtc` is inside the start margin of a shift (from 30 min before start until its end). */
export function isWithinStartMargin(
  startsAtUtc: string,
  endsAtUtc: string,
  nowUtc: string,
): boolean {
  const now = Date.parse(nowUtc);
  return (
    now >= Date.parse(startsAtUtc) - SHIFT_START_MARGIN_MINUTES * 60_000 &&
    now <= Date.parse(endsAtUtc)
  );
}

/** Minutes late against the assignment start, or `null` when on time. */
export function lateStartMinutes(assignmentStartUtc: string, startedAtUtc: string): number | null {
  const minutes = Math.floor((Date.parse(startedAtUtc) - Date.parse(assignmentStartUtc)) / 60_000);
  return minutes > 0 ? minutes : null;
}
