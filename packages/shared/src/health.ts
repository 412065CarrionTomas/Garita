import { z } from 'zod';

/** Respuesta del endpoint de disponibilidad de la API (GET /api/v1/health/live). */
export const liveHealthResponseSchema = z.object({
  status: z.literal('ok'),
  timestamp: z.iso.datetime(),
});

export type LiveHealthResponse = z.infer<typeof liveHealthResponseSchema>;
