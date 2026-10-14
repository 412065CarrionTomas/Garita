import { z } from 'zod';
import { fieldLocationSchema } from './shift-execution';

/**
 * HU-11 contract between the guard app and the API for checkpoint records (`POST /registros-puntos`).
 * HU-12 (NFC) reuses it with `method: 'nfc'`; HU-13 sends the same items in batches. Changes are additive.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** How the guard identified the checkpoint. */
export const CHECKPOINT_RECORD_METHODS = ['qr', 'nfc'] as const;
export type CheckpointRecordMethod = (typeof CHECKPOINT_RECORD_METHODS)[number];

/** NFC state of the phone when the record was taken (HU-15 uses it for the "QR on a tagged point" flag). */
export const PHONE_NFC_STATES = ['on', 'off', 'unsupported'] as const;
export type PhoneNfcState = (typeof PHONE_NFC_STATES)[number];

/** Why a scan did not produce a record. The `outdated_version` one is highlighted to the supervisor. */
export const INVALID_SCAN_REASONS = [
  'malformed',
  'signature',
  'other_site',
  'outdated_version',
  'unknown_checkpoint',
  'tag_not_associated',
  'tag_replaced',
] as const;
export type InvalidScanReason = (typeof INVALID_SCAN_REASONS)[number];

/** Body of `POST /registros-puntos`. `recordId` is generated on the phone; a repeated id is accepted once. */
export const checkpointRecordRequestSchema = z.object({
  recordId: z.uuid(),
  shiftId: z.string().min(1),
  method: z.enum(CHECKPOINT_RECORD_METHODS),
  /** Raw content read: the QR payload or the NFC uid. The server verifies it again. */
  scannedValue: z.string().min(1).max(512),
  occurredAtDevice: isoDateTime,
  location: fieldLocationSchema,
  phoneNfc: z.enum(PHONE_NFC_STATES),
});
export type CheckpointRecordRequest = z.infer<typeof checkpointRecordRequestSchema>;

/** Response of `POST /registros-puntos`, the same for a first delivery and for a repeated `recordId`. */
export const checkpointRecordResponseSchema = z.discriminatedUnion('result', [
  z.object({
    result: z.literal('recorded'),
    recordId: z.uuid(),
    checkpointId: z.string(),
    /** Windows the record counts for, as decided by `imputeRecord`; empty when out of window. */
    countedFor: z.array(
      z.object({ roundId: z.string(), windowIndex: z.number().int(), late: z.boolean() }),
    ),
    outOfWindow: z.boolean(),
  }),
  z.object({
    result: z.literal('rejected'),
    recordId: z.uuid(),
    reason: z.enum(INVALID_SCAN_REASONS),
  }),
  z.object({
    /** No record generated: already recorded in the current window of every round, or too soon. */
    result: z.literal('not_generated'),
    recordId: z.uuid(),
    cause: z.enum(['already_recorded', 'too_soon']),
    retryAfterUtc: isoDateTime.nullable(),
  }),
]);
export type CheckpointRecordResponse = z.infer<typeof checkpointRecordResponseSchema>;

/** Error codes in the `code` field of 4xx responses of `POST /registros-puntos`. */
export const CHECKPOINT_RECORD_ERROR_CODES = {
  /** 409: the shift is not in progress for the guard's current assignment. */
  shiftNotInProgress: 'SHIFT_NOT_IN_PROGRESS',
  /** 409: the same `recordId` was already used for a different payload. */
  recordIdConflict: 'RECORD_ID_CONFLICT',
} as const;
