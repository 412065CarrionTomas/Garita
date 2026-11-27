import { z } from 'zod';
import { roundRouteSchema } from './route';

/** Versiones por pedido en `GET /rondas/versiones?ids=`. */
export const GUARD_ROUND_VERSIONS_MAX = 20;

export const guardRoundVersionsQuerySchema = z.object({
  ids: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().min(1)).min(1).max(GUARD_ROUND_VERSIONS_MAX)),
});

/**
 * Una versión de ronda no cambia nunca: el celular la guarda por id y no vuelve a pedirla.
 * Los puntos van en el orden del recorrido.
 */
export const guardRoundVersionSchema = z.object({
  id: z.string(),
  roundId: z.string(),
  name: z.string(),
  frequencyMinutes: z.number().int().positive(),
  windowStartLocal: z.string(),
  windowEndLocal: z.string(),
  checkpoints: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      latitude: z.number(),
      longitude: z.number(),
      isIndoor: z.boolean(),
    }),
  ),
  route: roundRouteSchema.nullable(),
});
export type GuardRoundVersion = z.infer<typeof guardRoundVersionSchema>;
export const guardRoundVersionsSchema = z.array(guardRoundVersionSchema);
