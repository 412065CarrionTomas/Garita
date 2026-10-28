export const ROUND_WINDOW_STATUSES = [
  'pending',
  'in_progress',
  'late',
  'complete',
  'complete_late',
  'incomplete',
  'not_done',
  'pending_sync',
  'in_review',
] as const;

export type RoundWindowStatus = (typeof ROUND_WINDOW_STATUSES)[number];

export interface RoundWindowStatusInput {
  now: Date;
  startsAt: Date;
  endsAt: Date;
  graceEndsAt: Date;
  recordedCount: number;
  expectedCount: number;
  completedLate?: boolean;
  pendingSync?: boolean;
  shiftEndedWithoutCoverage?: boolean;
  syncedUntil?: Date | null;
  coverage?:
    | 'active'
    | 'absent'
    | 'unassigned'
    | 'cancelled'
    | 'guard_closed'
    | 'guard_closed_after'
    | 'admin_closed_before'
    | 'admin_closed_after'
    | 'site_closed_after';
}

export function computeRoundWindowStatus(input: RoundWindowStatusInput): RoundWindowStatus {
  if (input.coverage === 'cancelled' || input.coverage === 'site_closed_after') return 'pending';
  if (input.expectedCount === 0) return 'complete';
  if (input.recordedCount >= input.expectedCount && input.expectedCount > 0) {
    return input.completedLate ? 'complete_late' : 'complete';
  }
  if (input.now < input.startsAt) return 'pending';
  if (input.coverage === 'guard_closed_after' || input.coverage === 'admin_closed_after')
    return input.now >= input.endsAt ? 'not_done' : 'in_progress';
  if (input.coverage === 'absent' || input.coverage === 'unassigned')
    return input.now >= input.graceEndsAt
      ? 'not_done'
      : input.now >= input.endsAt
        ? 'late'
        : 'in_progress';
  if (input.pendingSync && input.now >= input.endsAt) return 'pending_sync';
  if (input.now < input.endsAt) return 'in_progress';
  if (input.now < input.graceEndsAt) return 'late';
  if (
    input.coverage !== 'guard_closed' &&
    input.syncedUntil !== undefined &&
    (!input.syncedUntil || input.syncedUntil < input.graceEndsAt)
  )
    return 'pending_sync';
  if (input.recordedCount === 0) return 'not_done';
  return 'incomplete';
}
