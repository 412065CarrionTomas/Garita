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
