import { z } from 'zod';

import { localDateTimeToUtc } from './rounds/windows';

/**
 * Account state contract (HU-41, HU-30, HU-43). One state per company; the subscription keeps
 * mirroring Mercado Pago in `subscriptions.ts`. Changes are additive.
 */
export const ACCOUNT_STATUSES = ['trial', 'active', 'grace', 'suspended'] as const;
export const accountStatusSchema = z.enum(ACCOUNT_STATUSES);
export type AccountStatus = z.infer<typeof accountStatusSchema>;

export const SUSPENSION_REASONS = ['trial_expired', 'grace_expired', 'cancelled'] as const;
export const suspensionReasonSchema = z.enum(SUSPENSION_REASONS);
export type SuspensionReason = z.infer<typeof suspensionReasonSchema>;

export const TRIAL_DAYS = 14;
export const GRACE_DAYS = 7;
/** Days left when the admin is reminded (HU-41: 7, 3 and 1; HU-30: 3 and the last day). */
export const TRIAL_REMINDER_DAYS = [7, 3, 1] as const;
export const GRACE_REMINDER_DAYS = [3, 1] as const;

const LAST_MINUTE_OF_DAY = 23 * 60 + 59;

function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
}

function endOfLocalDay(from: Date, daysAhead: number, timezone: string): Date {
  return localDateTimeToUtc(
    localDate(from, timezone),
    daysAhead * 1440 + LAST_MINUTE_OF_DAY,
    timezone,
  );
}

/** The creation day is day 1: the trial ends at 23:59 of day 14, company local time. */
export function trialEndsAt(createdAt: Date, timezone: string): Date {
  return endOfLocalDay(createdAt, TRIAL_DAYS - 1, timezone);
}

/** Seven full days after the rejected charge, until 23:59 company local time. */
export function graceEndsAt(rejectedAt: Date, timezone: string): Date {
  return endOfLocalDay(rejectedAt, GRACE_DAYS, timezone);
}

/** Calendar days left including today, in company local time; 0 once `endsAt` passed. */
export function daysLeft(endsAt: Date, now: Date, timezone: string): number {
  if (now > endsAt) return 0;
  const day = (at: Date) => Date.parse(`${localDate(at, timezone)}T00:00:00Z`);
  return Math.round((day(endsAt) - day(now)) / 86_400_000) + 1;
}

/** Guards that count toward the plan limit (HU-29): active and with a pending invitation. */
export function countsTowardGuardLimit(status: string): boolean {
  return status === 'active' || status === 'invitation_pending';
}

/**
 * Limit that applies to new and reactivated guards: without a plan (trial) the most basic plan's;
 * with a requested downgrade (HU-42) the smaller of both, so applying it never exceeds the limit.
 */
export function effectiveGuardLimit(input: {
  planMaxGuards: number | null;
  pendingPlanMaxGuards: number | null;
  basicPlanMaxGuards: number;
}): number {
  if (input.planMaxGuards === null) return input.basicPlanMaxGuards;
  if (input.pendingPlanMaxGuards === null) return input.planMaxGuards;
  return Math.min(input.planMaxGuards, input.pendingPlanMaxGuards);
}

/** `GET /cuenta/estado`, admin only. Dates are ISO strings; `amountDue` is a decimal string. */
export const accountStateResponseSchema = z.object({
  status: accountStatusSchema,
  suspensionReason: suspensionReasonSchema.nullable(),
  trialEndsAt: z.string().nullable(),
  trialDaysLeft: z.number().int().nullable(),
  graceEndsAt: z.string().nullable(),
  graceDaysLeft: z.number().int().nullable(),
  amountDue: z.string().nullable(),
  guardLimit: z.number().int(),
  guardsCounted: z.number().int(),
});
export type AccountStateResponse = z.infer<typeof accountStateResponseSchema>;

/** Error code of the 403 every role gets while the account is suspended (HU-43). */
export const ACCOUNT_SUSPENDED_CODE = 'account_suspended';
/** Error code of the 409 when a new or reactivated guard would exceed the plan limit. */
export const GUARD_LIMIT_REACHED_CODE = 'guard_limit_reached';
