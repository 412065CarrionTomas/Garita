import { z } from 'zod';
import { fieldLocationSchema } from './field/shift-execution';
import { deviceClockSchema } from './field/trusted-time';

/**
 * Sprint 4 contract for the panic alert: the app sends it (HU-21, HU-22, HU-23), the panel attends it (HU-24) and the
 * SMS webhook (HU-37) parses it. Changes are additive.
 */

const isoDateTime = z.iso.datetime({ offset: true });

export const PANIC_STATUSES = ['active', 'confirmed', 'resolved'] as const;
export type PanicStatus = (typeof PANIC_STATUSES)[number];

export const PANIC_CHANNELS = ['internet', 'sms'] as const;
export type PanicChannel = (typeof PANIC_CHANNELS)[number];

export const PANIC_OUTCOMES = ['real_emergency', 'false_alarm', 'test'] as const;
export type PanicOutcome = (typeof PANIC_OUTCOMES)[number];

/** SMS states the guard sees (HU-23), besides "received" and "confirmed" of HU-21. */
export const PANIC_SMS_STATES = ['sent', 'delivered', 'prepared', 'failed'] as const;
export type PanicSmsState = (typeof PANIC_SMS_STATES)[number];

/** Seconds without server confirmation before the SMS channel starts (HU-21, HU-23). */
export const PANIC_SMS_FALLBACK_SECONDS = 8;
/** Seconds without confirmation before the alert is resent and escalated (HU-24). */
export const PANIC_ESCALATION_SECONDS = 120;

/** Body of `POST /alertas-panico`. `alertId` is generated on the phone; a repeated id is one more activation. */
export const createPanicAlertRequestSchema = z.object({
  alertId: z.uuid(),
  shiftId: z.string().min(1),
  occurredAtDevice: isoDateTime,
  clock: deviceClockSchema.optional(),
  location: fieldLocationSchema,
});
export type CreatePanicAlertRequest = z.infer<typeof createPanicAlertRequestSchema>;

/** Body of `PATCH /alertas-panico/:alertId/ubicacion`: a more precise location of the same alert. */
export const updatePanicLocationRequestSchema = z.object({ location: fieldLocationSchema });
export type UpdatePanicLocationRequest = z.infer<typeof updatePanicLocationRequestSchema>;

/** What the app shows: only confirmed states. */
export const panicAlertStateResponseSchema = z.object({
  alertId: z.uuid(),
  status: z.enum(PANIC_STATUSES),
  receivedAt: isoDateTime,
  confirmedAt: isoDateTime.nullable(),
});
export type PanicAlertStateResponse = z.infer<typeof panicAlertStateResponseSchema>;

/** Body to resolve a confirmed alert (HU-24). */
export const resolvePanicAlertRequestSchema = z.object({
  outcome: z.enum(PANIC_OUTCOMES),
  comment: z.string().trim().min(5).max(1000),
});
export type ResolvePanicAlertRequest = z.infer<typeof resolvePanicAlertRequestSchema>;

/** Supervisor/admin inbox; the active count ignores the current filters. */
export const panicAlertsQuerySchema = z
  .object({
    estado: z.enum(PANIC_STATUSES).optional(),
    predio: z.string().min(1).max(100).optional(),
    pagina: z.coerce.number().int().min(1).max(100000).default(1),
  })
  .strict();

export const panicAlertSummarySchema = z.object({
  id: z.uuid(),
  status: z.enum(PANIC_STATUSES),
  channel: z.enum(PANIC_CHANNELS),
  authenticated: z.boolean().default(true),
  phoneMismatch: z.boolean().default(false),
  triggeredAt: isoDateTime,
  receivedAt: isoDateTime,
  site: z.object({ id: z.string(), name: z.string() }),
  guard: z.object({ name: z.string(), phone: z.string().nullable() }),
  confirmedAt: isoDateTime.nullable(),
  escalatedAt: isoDateTime.nullable(),
});

export const panicAlertDetailSchema = panicAlertSummarySchema.extend({
  timezone: z.string(),
  authenticated: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  accuracyMeters: z.number().nullable(),
  confirmedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  resolvedAt: isoDateTime.nullable(),
  resolvedBy: z.object({ id: z.string(), name: z.string() }).nullable(),
  outcome: z.enum(PANIC_OUTCOMES).nullable(),
  resolutionComment: z.string().nullable(),
  smsDeliveries: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      reason: z.enum(['initial', 'escalation']),
      status: z.enum(['accepted', 'failed', 'skipped']),
      createdAt: isoDateTime,
    }),
  ),
});

/** First 8 characters of the alert id, upper case: identifies the alert inside the SMS. */
export function panicShortId(alertId: string): string {
  return alertId.replace(/-/g, '').slice(0, 8).toUpperCase();
}

/** GSM-safe text: no accents and only letters, digits, spaces and `.,:-/?=`. */
function smsSafe(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^A-Za-z0-9 .,:\-/?=]/g, '')
    .replace(/ +/g, ' ');
}

export interface PanicSmsInput {
  alertId: string;
  /** Per-shift authentication code (HU-23). */
  shiftCode: string;
  /** Local time `HH:mm`, already formatted in the site's time zone. */
  time: string;
  latitude: number | null;
  longitude: number | null;
  /** Only for the backup destination (the company's guard phone): site name and map link are added. */
  backup?: { siteName: string };
}

/** Single 160-character SMS, e.g. `GARITA PANICO K7Q2M9XA T:483920 03:10 -31.42013,-64.18877`. */
export function buildPanicSms(input: PanicSmsInput): string {
  const { latitude, longitude } = input;
  const hasLocation = latitude !== null && longitude !== null;
  const coords = hasLocation ? `${latitude.toFixed(5)},${longitude.toFixed(5)}` : 'SIN-UBICACION';
  const parts = [
    'GARITA PANICO',
    panicShortId(input.alertId),
    `T:${smsSafe(input.shiftCode)}`,
    smsSafe(input.time),
    coords,
  ];
  if (input.backup) {
    parts.push(smsSafe(input.backup.siteName).trim().slice(0, 30));
    if (hasLocation) parts.push(`maps.google.com/?q=${coords}`);
  }
  return parts.join(' ').slice(0, 160);
}

export interface ParsedPanicSms {
  shortId: string;
  shiftCode: string;
  time: string;
  latitude: number | null;
  longitude: number | null;
}

const PANIC_SMS_PATTERN =
  /^GARITA PANICO ([0-9A-F]{8}) T:([A-Za-z0-9]+) (\d{2}:\d{2}) (?:(-?\d+\.\d+),(-?\d+\.\d+)|SIN-UBICACION)/;

/** Reads the platform format back (HU-37); returns null when the text is not a Garita panic SMS. */
export function parsePanicSms(text: string): ParsedPanicSms | null {
  const match = PANIC_SMS_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, shortId = '', shiftCode = '', time = '', lat, lng] = match;
  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
    (lat !== undefined && (Math.abs(Number(lat)) > 90 || Math.abs(Number(lng)) > 180))
  )
    return null;
  return {
    shortId,
    shiftCode,
    time,
    latitude: lat === undefined ? null : Number(lat),
    longitude: lng === undefined ? null : Number(lng),
  };
}
