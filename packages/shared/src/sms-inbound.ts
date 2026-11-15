import { z } from 'zod';

/**
 * HU-37 contract: how an SMS received on the platform number was authenticated.
 * - `valid`: the shift code matches a shift in progress.
 * - `unverified`: no valid code, but the sender is a guard with a shift in progress.
 * - `unknown`: neither matches; no alert is created, the message is kept for review.
 */
export const SMS_INBOUND_AUTH_RESULTS = ['valid', 'unverified', 'unknown'] as const;
export const smsInboundAuthResultSchema = z.enum(SMS_INBOUND_AUTH_RESULTS);
export type SmsInboundAuthResult = z.infer<typeof smsInboundAuthResultSchema>;

/**
 * Argentine number reduced to its 10 national digits (area code + subscriber), so
 * `+54 9 351 123-4567`, `+543511234567` and `0351 15 1234567` compare equal.
 * Numbers that don't reduce to 10 digits are returned as their bare digits.
 */
export function normalizeArPhone(raw: string): string {
  let digits = raw.replace(/\D/g, '').replace(/^00/, '');
  if (digits.startsWith('54')) digits = digits.slice(2);
  digits = digits.replace(/^0/, '');
  if (digits.length === 11 && digits.startsWith('9')) digits = digits.slice(1);
  if (digits.length === 12) {
    // shortcut: drops the first "15" found after a 2 to 4 digit area code, upgrade to a
    // table of area codes if two guards ever collide.
    for (const areaLength of [2, 3, 4]) {
      if (digits.slice(areaLength, areaLength + 2) === '15') {
        return digits.slice(0, areaLength) + digits.slice(areaLength + 2);
      }
    }
  }
  return digits;
}

export function sameArPhone(a: string, b: string): boolean {
  return normalizeArPhone(a) === normalizeArPhone(b);
}
