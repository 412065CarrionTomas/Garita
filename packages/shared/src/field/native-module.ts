import { z } from 'zod';

export const nativeLocationSchema = z.object({
  latitude: z.number().gte(-90).lte(90),
  longitude: z.number().gte(-180).lte(180),
  accuracyMeters: z.number().nonnegative(),
  timestamp: z.iso.datetime({ offset: true }),
  simulation: z.enum(['simulated', 'not_simulated', 'unavailable']),
});
export type NativeLocation = z.infer<typeof nativeLocationSchema>;
export type SimulationStatus = NativeLocation['simulation'];
export interface NativeModuleCapabilities {
  moduleVersion: string;
  simulationDetectionAvailable: boolean;
}
