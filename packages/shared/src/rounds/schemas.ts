import { z } from 'zod';
import { speedKmhSchema, speedProfileSchema } from '../marcas/types';
import { legCount, routeInputSchema } from './route';
import { validateWindowConfig } from './windows';

export const roundInputSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    checkpointIds: z.array(z.string().min(1)).min(1),
    frequencyMinutes: z.number().int(),
    windowStartLocal: z.string(),
    windowEndLocal: z.string(),
    graceMinutes: z.number().int(),
    /** Opcional: sin recorrido, la API arma uno por calles con regreso al inicio. */
    route: routeInputSchema.optional(),
    /** El supervisor aceptó guardar rectas las secciones que no se pudieron calcular por calles. */
    allowStraight: z.boolean().optional(),
    /** Sin perfil (o null): la ronda usa la velocidad del predio. */
    speedProfile: speedProfileSchema.nullish(),
    /** Solo con el perfil personalizado; los demás usan su velocidad por defecto. */
    maxSpeedKmh: speedKmhSchema.nullish(),
  })
  .superRefine((value, context) => {
    for (const { field, message } of validateWindowConfig(value))
      context.addIssue({ code: 'custom', message, path: [field] });
    if (value.speedProfile === 'custom' && value.maxSpeedKmh == null)
      context.addIssue({
        code: 'custom',
        message: 'El perfil personalizado requiere indicar la velocidad en km/h',
        path: ['maxSpeedKmh'],
      });
    const legs = legCount(value.checkpointIds.length, value.route?.closed ?? true);
    if (value.route && value.route.legs.length !== legs)
      context.addIssue({
        code: 'custom',
        message: `El recorrido debe tener ${String(legs)} tramos para estos puntos.`,
        path: ['route', 'legs'],
      });
    if (new Set(value.checkpointIds).size !== value.checkpointIds.length)
      context.addIssue({
        code: 'custom',
        message: 'No se pueden repetir puntos.',
        path: ['checkpointIds'],
      });
  });

export type RoundInput = z.infer<typeof roundInputSchema>;

export const previewRoundSchema = z
  .object({
    frequencyMinutes: z.number().int(),
    windowStartLocal: z.string(),
    windowEndLocal: z.string(),
    graceMinutes: z.number().int(),
  })
  .superRefine((value, context) => {
    for (const { field, message } of validateWindowConfig(value))
      context.addIssue({ code: 'custom', message, path: [field] });
  });
