/**
 * Sprint 4 contract for the assignments of a shift (HU-44). HU-17 evaluates and HU-25 attributes each window
 * with `windowOwner`, so the three agree on who a window belongs to. Changes are additive.
 */

export const ASSIGNMENT_RESULTS = [
  'scheduled',
  'started',
  'absent',
  'replaced',
  'closed_early',
] as const;
export type AssignmentResult = (typeof ASSIGNMENT_RESULTS)[number];

export interface AssignmentOwnerSource {
  id: string;
  startsAt: string;
  result: AssignmentResult;
}

/**
 * A window belongs to the assignment in force when it ends. A window ending exactly at the start of a replacement
 * stays with the previous assignment. A `replaced` assignment was swapped before its start and never governed.
 * Returns null when the window ends before every assignment starts.
 */
export function windowOwner(
  windowEndsAt: string,
  assignments: readonly AssignmentOwnerSource[],
): string | null {
  const end = Date.parse(windowEndsAt);
  let owner: AssignmentOwnerSource | null = null;
  for (const assignment of assignments) {
    if (assignment.result === 'replaced') continue;
    const start = Date.parse(assignment.startsAt);
    if (start < end && (!owner || start > Date.parse(owner.startsAt))) owner = assignment;
  }
  return owner?.id ?? null;
}
