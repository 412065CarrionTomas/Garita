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
}

export function computeRoundWindowStatus(input: RoundWindowStatusInput): RoundWindowStatus {
  if (input.expectedCount === 0) return 'complete';
  if (input.recordedCount >= input.expectedCount && input.expectedCount > 0) {
    return input.completedLate ? 'complete_late' : 'complete';
  }
  if (input.now < input.startsAt) return 'pending';
  if (input.pendingSync && input.now >= input.endsAt) return 'pending_sync';
  if (input.now < input.endsAt) return 'in_progress';
  if (input.now < input.graceEndsAt) return 'late';
  if (input.shiftEndedWithoutCoverage || input.recordedCount === 0) return 'not_done';
  return 'incomplete';
}
