import { z } from 'zod';
import { recordStatusSchema } from './sites';

export const checkpointInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  toleranceRadiusMeters: z.number().int().min(10).max(200).default(30),
  stickerLocation: z.string().trim().max(500).optional(),
  isIndoor: z.boolean().default(false),
  confirmFarLocation: z.boolean().optional(),
});

export const checkpointResponseSchema = z.looseObject({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  latitude: z.union([z.number(), z.string()]),
  longitude: z.union([z.number(), z.string()]),
  toleranceRadiusMeters: z.number(),
  stickerLocation: z.string().nullable(),
  isIndoor: z.boolean(),
  qrVersion: z.number().int(),
  status: recordStatusSchema,
});

export const checkpointsResponseSchema = z.array(checkpointResponseSchema);
export const checkpointListQuerySchema = z.object({
  puntos: z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').filter(Boolean) : value),
    z.array(z.string().min(1)).optional(),
  ),
});
export type CheckpointInput = z.infer<typeof checkpointInputSchema>;
