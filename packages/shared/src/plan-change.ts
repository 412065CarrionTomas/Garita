import { z } from 'zod';
import {
  guardSelectionSchema,
  guardSelectionRequiredSchema,
  planResponseSchema,
} from './subscriptions';

export const planChangeRequestSchema = z
  .object({
    planId: z.string().min(1),
    guardSelection: guardSelectionSchema.optional(),
  })
  .strict();
export type PlanChangeRequest = z.infer<typeof planChangeRequestSchema>;
export const planChangeQuerySchema = z.object({ plan: z.string().min(1) }).strict();
export const planChangeSimulationSchema = z.object({
  type: z.enum(['upgrade', 'downgrade', 'downgrade_cancelled']),
  amount: z.string(),
  effectiveAt: z.string(),
  remainingDays: z.number().int().nonnegative(),
  cycleDays: z.number().int().positive(),
  guardSelectionRequired: guardSelectionRequiredSchema.nullable(),
});
export const planChangeResponseSchema = z.object({
  initPoint: z.url().nullable(),
  effectiveAt: z.string(),
});
export const SUBSCRIPTION_CHANGE_TYPES = [
  'upgrade',
  'downgrade_scheduled',
  'downgrade_applied',
  'cancellation',
  'cancellation_reverted',
] as const;
export const planChangeHistorySchema = z.object({
  pendingPlan: planResponseSchema.nullable(),
  pendingEffectiveAt: z.string().nullable(),
  payments: z.array(
    z.object({
      id: z.string(),
      amount: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']),
      rejectionReason: z.string().nullable(),
      expiresAt: z.string(),
      amountUpdatePending: z.boolean(),
    }),
  ),
  changes: z.array(
    z.object({
      id: z.string(),
      type: z.enum(SUBSCRIPTION_CHANGE_TYPES),
      planName: z.string(),
      effectiveAt: z.string(),
      createdAt: z.string(),
      adminName: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});
