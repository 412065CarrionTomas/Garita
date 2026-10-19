import { z } from 'zod';

import { notificationKindSchema } from './notifications';

/** Socket.IO namespace; clients send the Firebase ID token in `auth.token` of the handshake. */
export const SOCKET_NAMESPACE = '/tiempo-real';

export const REALTIME_EVENTS = {
  shiftUpdated: 'turno.actualizado',
  recordNew: 'registro.nuevo',
  incidentNew: 'incidente.nuevo',
  noticeNew: 'aviso.nuevo',
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

export type RealtimeEventName = (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];
export interface RealtimeEventPayloads {
  'turno.actualizado': z.infer<typeof shiftUpdatedEventSchema>;
  'registro.nuevo': z.infer<typeof recordNewEventSchema>;
  'incidente.nuevo': z.infer<typeof incidentNewEventSchema>;
  'aviso.nuevo': z.infer<typeof noticeNewEventSchema>;
}
