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

export interface PlanResponse {
  id: string;
  name: string;
  /** Pesos with two decimals, as a string to avoid floating point. */
  monthlyPrice: string;
  maxGuards: number;
}

export interface CreateSubscriptionResponse {
  /** Mercado Pago page where the admin loads the card and authorizes the debit. */
  initPoint: string;
}

export interface SubscriptionChargeResponse {
  id: string;
  amount: string;
  status: SubscriptionChargeStatus;
  statusDetail: string | null;
  chargedAt: string | null;
}

export interface SubscriptionResponse {
  trialEndsAt: string | null;
  subscription: {
    id: string;
    status: SubscriptionStatus;
    plan: PlanResponse;
    payerEmail: string;
    startsAt: string;
    nextChargeAt: string | null;
    lastFailureReason: string | null;
    charges: SubscriptionChargeResponse[];
  } | null;
}
