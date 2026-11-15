import { z } from 'zod';

/**
 * HU-29 contract: subscription and charge states mirror Mercado Pago's (preapproval and
 * authorized_payment). Changes are additive.
 */

export const SUBSCRIPTION_STATUSES = ['pending', 'authorized', 'paused', 'cancelled'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

/** A company can hold only one subscription in these states at a time. */
export const OPEN_SUBSCRIPTION_STATUSES = [
  'pending',
  'authorized',
  'paused',
] as const satisfies readonly SubscriptionStatus[];

export const SUBSCRIPTION_CHARGE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type SubscriptionChargeStatus = (typeof SUBSCRIPTION_CHARGE_STATUSES)[number];

export const createSubscriptionRequestSchema = z
  .object({
    planId: z.string().min(1),
    /** Email of the Mercado Pago account that will pay; it may differ from the admin's email. */
    payerEmail: z.email(),
    /** During a free trial, true defers the first charge to the end of the trial. */
    keepTrial: z.boolean().default(false),
  })
  .strict();
export type CreateSubscriptionRequest = z.infer<typeof createSubscriptionRequestSchema>;

export const planResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Pesos with two decimals, as a string to avoid floating point. */
  monthlyPrice: z.string(),
  maxGuards: z.number().int(),
});
export type PlanResponse = z.infer<typeof planResponseSchema>;
export const plansResponseSchema = z.array(planResponseSchema);

export const createSubscriptionResponseSchema = z.object({
  /** Mercado Pago page where the admin loads the card and authorizes the debit. */
  initPoint: z.url(),
});
export type CreateSubscriptionResponse = z.infer<typeof createSubscriptionResponseSchema>;

export const subscriptionChargeResponseSchema = z.object({
  id: z.string(),
  amount: z.string(),
  status: z.enum(SUBSCRIPTION_CHARGE_STATUSES),
  statusDetail: z.string().nullable(),
  chargedAt: z.string().nullable(),
});
export type SubscriptionChargeResponse = z.infer<typeof subscriptionChargeResponseSchema>;

export const subscriptionResponseSchema = z.object({
  trialEndsAt: z.string().nullable(),
  subscription: z
    .object({
      id: z.string(),
      status: z.enum(SUBSCRIPTION_STATUSES),
      plan: planResponseSchema,
      payerEmail: z.string(),
      startsAt: z.string(),
      nextChargeAt: z.string().nullable(),
      lastFailureReason: z.string().nullable(),
      charges: z.array(subscriptionChargeResponseSchema),
    })
    .nullable(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;
