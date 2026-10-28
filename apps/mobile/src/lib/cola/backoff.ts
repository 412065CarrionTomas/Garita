import { SYNC_MAX_BACKOFF_SECONDS } from '@garita/shared';

/**
 * Pure function computing the retry wait time in seconds with exponential backoff.
 * Capped at `SYNC_MAX_BACKOFF_SECONDS` (5 minutes), with no limit on the number of attempts (CA11).
 */
export function computeSyncBackoff(
  attempt: number,
  baseSeconds = 5,
  maxSeconds = SYNC_MAX_BACKOFF_SECONDS,
): number {
  const safeAttempt = Math.max(0, Math.floor(attempt));
  // 2^safeAttempt can overflow to Infinity for large numbers; Math.min handles Infinity gracefully
  const exponentialSeconds = baseSeconds * 2 ** Math.min(safeAttempt, 30);
  return Math.min(maxSeconds, exponentialSeconds);
}
