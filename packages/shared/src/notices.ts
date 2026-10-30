import { z } from 'zod';

/**
 * Sprint 4 contract for the supervisor notices (HU-17, HU-35, HU-44): what the panel lists and what each emitter
 * raises through `NOTICES_PORT`. Each kind reuses its `NotificationKind` for the push. Changes are additive.
 */

export const NOTICE_KINDS = [
  'round_missed',
  'shift_unsynced',
  'shift_not_started',
  'shift_closed_early',
  'shift_without_guard',
] as const;
export type NoticeKind = (typeof NOTICE_KINDS)[number];

export const NOTICE_STATUSES = ['open', 'resolved'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** Why a notice stopped being open. */
export const NOTICE_RESOLUTIONS = [
  'data_arrived',
  'late_start',
  'reassigned',
  'covered',
  'guard_assigned',
  'closed_without_data',
] as const;
export type NoticeResolution = (typeof NOTICE_RESOLUTIONS)[number];

/** Only `shift_not_started` can be muted as a push by each supervisor (HU-35); the rest always notify. */
export const MUTABLE_NOTICE_KINDS = ['shift_not_started'] as const satisfies readonly NoticeKind[];

/**
 * Idempotency key of a notice: at most one per window (`round_missed`), per assignment (`shift_not_started`,
 * `shift_closed_early`) or per shift (`shift_unsynced`, `shift_without_guard`).
 */
export function noticeKey(kind: NoticeKind, subjectId: string): string {
  return `${kind}:${subjectId}`;
}

/** Body to close an unsynced shift without data (HU-17). */
export const closeWithoutDataRequestSchema = z.object({
  reason: z.string().trim().min(5).max(500),
});
export type CloseWithoutDataRequest = z.infer<typeof closeWithoutDataRequestSchema>;

/** Query of the notices list of the panel. */
export const noticesQuerySchema = z.object({
  status: z.enum(NOTICE_STATUSES).optional(),
  kind: z.enum(NOTICE_KINDS).optional(),
  siteId: z.string().min(1).optional(),
});
export type NoticesQuery = z.infer<typeof noticesQuerySchema>;

/** Additive HTTP response contract. Times are serialized by the API as ISO strings. */
export const noticeSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  siteId: z.string(),
  shiftId: z.string(),
  kind: z.enum(NOTICE_KINDS),
  subjectId: z.string(),
  key: z.string(),
  status: z.enum(NOTICE_STATUSES),
  resolution: z.enum(NOTICE_RESOLUTIONS).nullable(),
  details: z.json().nullable(),
  createdAt: z.iso.datetime(),
  resolvedAt: z.iso.datetime().nullable(),
  seenAt: z.iso.datetime().nullable(),
  site: z.object({ name: z.string() }),
  shift: z.object({ startsAt: z.iso.datetime(), endsAt: z.iso.datetime() }),
});
export const noticesListResponseSchema = z.object({
  items: z.array(noticeSchema),
  openCount: z.number().int().nonnegative(),
  unseenOpenCount: z.number().int().nonnegative(),
});
