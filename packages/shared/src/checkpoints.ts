import { z } from 'zod';
import { recordStatusSchema } from './sites';

export const checkpointInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  toleranceRadiusMeters: z.number().int().min(10).max(200).default(30),
  stickerLocation: z.string().trim().max(500).optional(),
  /** Calle y número del punto; null (o vacía) si no hay domicilio cerca. Sin el campo, no se toca. */
  address: z
    .string()
    .trim()
    .max(300)
    .transform((value) => value || null)
    .nullable()
    .optional(),
  isIndoor: z.boolean().default(false),
  confirmFarLocation: z.boolean().optional(),
});

/** Todos los puntos activos del predio, en su nuevo orden (el primero pasa a ser el N° 1). */
export const checkpointArrangementInputSchema = z.object({
  puntos: z
    .array(
      z.object({
        id: z.string().min(1),
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        address: z
          .string()
          .trim()
          .max(300)
          .transform((value) => value || null)
          .nullable()
          .optional(),
      }),
    )
    .min(1)
    .max(500),
  confirmFarLocation: z.boolean().optional(),
});
export type CheckpointArrangementInput = z.infer<typeof checkpointArrangementInputSchema>;

export const checkpointResponseSchema = z.looseObject({
  id: z.string(),
  siteId: z.string(),
  name: z.string(),
  // La API las manda como texto (Decimal): número acá, porque Puntos y Rondas comparten la caché.
  latitude: z.coerce.number(),
  longitude: z.coerce.number(),
  toleranceRadiusMeters: z.number(),
  stickerLocation: z.string().nullable(),
  address: z.string().nullable().optional(),
  isIndoor: z.boolean(),
  /** Rondas activas que lo incluyen en su versión vigente. */
  roundsCount: z.number().int().optional(),
  /** Cómo se marca: con QR, o con la etiqueta NFC activa. */
  tagType: z.enum(['qr', 'nfc_basic', 'nfc_secure']).optional(),
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
