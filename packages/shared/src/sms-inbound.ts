import { z } from 'zod';
import { pageNumberSchema, pageSizeSchema } from './pagination';

/**
 * HU-37 contract: how an SMS received on the platform number was authenticated.
 * - `valid`: the shift code matches a shift in progress.
 * - `unverified`: no valid code, but the sender is a guard with a shift in progress.
 * - `unknown`: neither matches; no alert is created, the message is kept for review.
 */
export const SMS_INBOUND_AUTH_RESULTS = ['valid', 'unverified', 'unknown'] as const;
export const smsInboundAuthResultSchema = z.enum(SMS_INBOUND_AUTH_RESULTS);
export type SmsInboundAuthResult = z.infer<typeof smsInboundAuthResultSchema>;

export const smsWebhookBodySchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    from: z
      .string()
      .min(7)
      .max(40)
      .regex(/^\+?[\d ()-]+$/)
      .regex(/\d/),
    text: z.string().min(1).max(1600),
    receivedAt: z.iso.datetime({ offset: true }),
  })
  .strict();
export type SmsWebhookBody = z.infer<typeof smsWebhookBodySchema>;
export const smsInboundQuerySchema = z
  .object({
    estado: smsInboundAuthResultSchema.optional(),
    buscar: z.string().trim().max(100).optional(),
    pagina: pageNumberSchema,
    porPagina: pageSizeSchema,
  })
  .strict();
export const smsInboundListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      provider: z.string(),
      messageId: z.string(),
      fromOriginal: z.string(),
      fromNormalized: z.string(),
      text: z.string(),
      receivedAt: z.iso.datetime({ offset: true }),
      gatewayReceivedAt: z.iso.datetime({ offset: true }),
      result: smsInboundAuthResultSchema,
      alertId: z.uuid().nullable(),
      shiftId: z.string().nullable(),
      /** Quién lo mandó según el turno asociado; `null` si no se identificó. */
      sender: z.object({ guardName: z.string().nullable(), siteName: z.string() }).nullable(),
    }),
  ),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Conteos por resultado con la búsqueda aplicada, sin el filtro de estado. */
  resumen: z.object({ valid: z.number(), unverified: z.number(), unknown: z.number() }),
});

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
  const normalized = normalizeArPhone(a);
  return normalized !== '' && normalized === normalizeArPhone(b);
}
