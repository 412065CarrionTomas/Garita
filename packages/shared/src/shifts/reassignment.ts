import { z } from 'zod';
import { ASSIGNMENT_RESULTS } from '../assignments';

export const reassignShiftRequestSchema = z.object({
  guardId: z.string().min(1),
  startsAt: z.iso.datetime({ offset: true }).optional(),
});

export const shiftReplacementsQuerySchema = z.object({
  startsAt: z.iso.datetime({ offset: true }).optional(),
});

export const shiftReplacementsResponseSchema = z.array(
  z.object({ id: z.string(), firstName: z.string(), lastName: z.string() }),
);

export const shiftAssignmentHistorySchema = z.array(
  z.object({
    id: z.string(),
    guardId: z.string().nullable(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    result: z.enum(ASSIGNMENT_RESULTS),
    isCurrent: z.boolean(),
    reassignedAt: z.iso.datetime().nullable(),
    guard: z.object({ firstName: z.string(), lastName: z.string() }).nullable(),
    assignedBy: z.object({ firstName: z.string(), lastName: z.string() }),
  }),
);

export const reassignShiftResponseSchema = z.object({
  shiftId: z.string(),
  assignmentId: z.string(),
  warning: z.literal('replacement_late').optional(),
});

export type ReassignShiftRequest = z.infer<typeof reassignShiftRequestSchema>;

export function previousAssignmentResult(input: {
  covering: boolean;
  hadGuard: boolean;
  previousStartsAt: Date;
  now: Date;
}): 'closed_early' | 'absent' | 'replaced' {
  if (input.covering) return 'closed_early';
  return input.hadGuard && input.now > input.previousStartsAt ? 'absent' : 'replaced';
}
