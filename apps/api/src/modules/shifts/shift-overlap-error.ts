/** Exclusion constraint that forbids two active overlapping assignments of the same guard. */
export const SHIFT_OVERLAP_CONSTRAINT = 'ShiftAssignment_no_overlap_active_guard';

/** PostgreSQL SQLSTATE for `exclusion_violation`. */
const EXCLUSION_VIOLATION_SQLSTATE = '23P01';

/**
 * `true` when a database error comes from the guard overlap exclusion constraint.
 * Prisma does not report exclusion violations with a stable error code across versions (P2004 in some,
 * P2039 or an unknown request error in others), so the check looks at the constraint name and SQLSTATE
 * carried by the error instead of relying on a single Prisma code.
 */
export function isShiftOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const details = [error.message, safeStringify((error as { meta?: unknown }).meta)].join(' ');
  return (
    details.includes(SHIFT_OVERLAP_CONSTRAINT) || details.includes(EXCLUSION_VIOLATION_SQLSTATE)
  );
}

function safeStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}
