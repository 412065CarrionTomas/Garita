import { z } from 'zod';

/** Días hacia atrás en los que un predio sigue en la lista del vigilador después de su último turno. */
export const GUARD_SITES_LOOKBACK_DAYS = 90;

/** Predio tal como lo necesita el vigilador en el campo: cómo llegar, cómo entrar y qué recorrer. */
export const guardSiteSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  accessInstructions: z.string().nullable(),
  supervisors: z.array(z.string()),
  rounds: z.array(z.object({ name: z.string(), checkpoints: z.number().int() })),
  nextShiftAt: z.iso.datetime().nullable(),
});
export type GuardSite = z.infer<typeof guardSiteSchema>;
export const guardSitesSchema = z.array(guardSiteSchema);
