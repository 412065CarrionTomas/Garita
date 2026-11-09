import { z } from 'zod';

import { notificationKindSchema } from './notifications';

/** Socket.IO namespace; clients send the Firebase ID token in `auth.token` of the handshake. */
export const SOCKET_NAMESPACE = '/tiempo-real';

export const REALTIME_EVENTS = {
  shiftUpdated: 'turno.actualizado',
  recordNew: 'registro.nuevo',
  incidentNew: 'incidente.nuevo',
  noticeNew: 'aviso.nuevo',
  noticeUpdated: 'aviso.actualizado',
  panicUpdated: 'panico.actualizado',
} as const;

// Payloads carry identifiers only: the panel fetches the detail over HTTP.
export const shiftUpdatedEventSchema = z.object({ shiftId: z.string(), siteId: z.string() });
export const recordNewEventSchema = z.object({
  shiftId: z.string(),
  siteId: z.string(),
  checkpointId: z.string(),
  recordId: z.string(),
});
export const incidentNewEventSchema = z.object({ incidentId: z.string(), siteId: z.string() });
export const noticeNewEventSchema = z.object({
  kind: notificationKindSchema,
  siteId: z.string(),
  shiftId: z.string().optional(),
});

/** A notice was resolved or changed (HU-17, HU-35, HU-44). */
export const noticeUpdatedEventSchema = z.object({ noticeId: z.string(), siteId: z.string() });
/** A panic alert was created, confirmed, escalated or resolved (HU-21, HU-24). */
export const panicUpdatedEventSchema = z.object({ alertId: z.string(), siteId: z.string() });

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];
export interface RealtimeEventPayloads {
  'turno.actualizado': z.infer<typeof shiftUpdatedEventSchema>;
  'registro.nuevo': z.infer<typeof recordNewEventSchema>;
  'incidente.nuevo': z.infer<typeof incidentNewEventSchema>;
  'aviso.nuevo': z.infer<typeof noticeNewEventSchema>;
  'aviso.actualizado': z.infer<typeof noticeUpdatedEventSchema>;
  'panico.actualizado': z.infer<typeof panicUpdatedEventSchema>;
}
