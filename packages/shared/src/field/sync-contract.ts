import { z } from 'zod';
import { checkpointRecordRequestSchema, checkpointRecordResponseSchema } from './checkpoint-record';
import { closeShiftRequestSchema, closeShiftResponseSchema } from './shift-execution';

/**
 * HU-13 contract between the guard app and the API for working without signal: the shift credential
 * (`shiftCredentialSchema`, in `shift-execution.ts`), the batch sync endpoint (`POST /sincronizacion/eventos`) and the connection notices
 * (`POST /avisos-conexion`). Both sides import these schemas; changes must be additive.
 */

const isoDateTime = z.iso.datetime({ offset: true });

/** Largest batch the server accepts; the app sends at most this many events per request. */
export const SYNC_BATCH_MAX_EVENTS = 100;
/** Seconds between connection notices while a shift is in progress, the app is in the foreground and there is signal. */
export const CONNECTION_NOTICE_INTERVAL_SECONDS = 120;
/** Longest wait between automatic retries of a failed sync (no limit on the number of attempts). */
export const SYNC_MAX_BACKOFF_SECONDS = 300;
/** Days after the scheduled end of the shift during which its credential still works. */
export const SHIFT_CREDENTIAL_VALID_DAYS_AFTER_END = 7;

/**
 * One event of the offline queue. `type` mirrors `PendingFieldEvent.type`; the id of the event is the one inside
 * its payload (`recordId` for records, `eventId` for the shift close). The shift start never goes through the queue.
 * The panic alert (HU-21, E5) will add its own type and its own request.
 */
export const syncEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('checkpoint_record'), payload: checkpointRecordRequestSchema }),
  z.object({ type: z.literal('shift_close'), payload: closeShiftRequestSchema }),
]);
export type SyncEvent = z.infer<typeof syncEventSchema>;

/** Id of an event: the one the phone generated inside its payload. */
export function syncEventId(event: SyncEvent): string {
  return event.type === 'checkpoint_record' ? event.payload.recordId : event.payload.eventId;
}

/** Body of `POST /sincronizacion/eventos`: up to `SYNC_BATCH_MAX_EVENTS` events of one shift, oldest first. */
export const syncBatchRequestSchema = z.object({
  shiftId: z.string().min(1),
  events: z.array(syncEventSchema).min(1).max(SYNC_BATCH_MAX_EVENTS),
  /** Events still queued on the phone after this batch. */
  pendingCount: z.number().int().nonnegative(),
  /** Trusted time up to which the server already has every event of the phone (CA7); `null` if none yet. */
  syncedUntil: isoDateTime.nullable(),
});
export type SyncBatchRequest = z.infer<typeof syncBatchRequestSchema>;

/** Why the server rejected one event; the app keeps it on the phone for diagnosis and goes on with the rest. */
export const SYNC_REJECTION_REASONS = [
  'invalid_data',
  'not_in_credential_shift',
  'unknown_event_type',
  'event_id_conflict',
] as const;
export type SyncRejectionReason = (typeof SYNC_REJECTION_REASONS)[number];

/** Outcome of one event of a batch, in the same order as the request. */
export const syncEventResultSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('accepted'),
    eventId: z.uuid(),
    /** Same body that the single-event endpoint returns (`POST /registros-puntos` or `POST /turnos/:id/cerrar`). */
    outcome: z.union([checkpointRecordResponseSchema, closeShiftResponseSchema]),
  }),
  z.object({ status: z.literal('duplicate'), eventId: z.uuid() }),
  z.object({
    status: z.literal('rejected'),
    eventId: z.string(),
    reason: z.enum(SYNC_REJECTION_REASONS),
    message: z.string(),
  }),
]);
export type SyncEventResult = z.infer<typeof syncEventResultSchema>;

/** Response of `POST /sincronizacion/eventos` (200 even when some events are rejected). */
export const syncBatchResponseSchema = z.object({
  results: z.array(syncEventResultSchema),
  receivedAt: isoDateTime,
});
export type SyncBatchResponse = z.infer<typeof syncBatchResponseSchema>;

/** Body of `POST /avisos-conexion`. */
export const connectionNoticeRequestSchema = z.object({
  shiftId: z.string().min(1),
  sentAtDevice: isoDateTime,
  pendingCount: z.number().int().nonnegative(),
  syncedUntil: isoDateTime.nullable(),
});
export type ConnectionNoticeRequest = z.infer<typeof connectionNoticeRequestSchema>;

/** Response of `POST /avisos-conexion`. */
export const connectionNoticeResponseSchema = z.object({ receivedAt: isoDateTime });
export type ConnectionNoticeResponse = z.infer<typeof connectionNoticeResponseSchema>;

/** Error codes in the `code` field of 4xx responses of the sync endpoints. */
export const SYNC_ERROR_CODES = {
  /** 401: missing, malformed, tampered with or expired shift credential. */
  invalidCredential: 'INVALID_SHIFT_CREDENTIAL',
  /** 403: the credential works only on the sync endpoints. */
  credentialScope: 'CREDENTIAL_SCOPE_NOT_ALLOWED',
} as const;

/**
 * `syncedUntil` after a send: the time of the last event the server received in order. When the whole queue was
 * sent it is the latest `occurredAtDevice` among all events (CA7).
 */
export function computeSyncedUntil(
  sentInOrder: readonly { occurredAtDevice: string }[],
  previous: string | null,
): string | null {
  let latest = previous;
  for (const event of sentInOrder) {
    if (latest === null || Date.parse(event.occurredAtDevice) > Date.parse(latest)) {
      latest = event.occurredAtDevice;
    }
  }
  return latest;
}
