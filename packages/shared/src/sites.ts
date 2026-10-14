import { z } from 'zod';
import { speedProfileSchema } from './marcas/types';

export const recordStatusSchema = z.enum(['active', 'inactive']);
export const clientInputSchema = z.object({
  name: z.string().trim().min(1).max(200),
  contactName: z.string().trim().min(1).max(200),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ().-]{7,30}$/),
  email: z.email().max(320),
  taxId: z.string().trim().max(20).optional(),
});
export const clientListQuerySchema = z.object({
  estado: z.preprocess(
    (value) => (value === '' ? undefined : value),
    recordStatusSchema.optional(),
  ),
  pagina: z.coerce.number().int().positive().default(1),
});
export const siteInputSchema = z.object({
  clientId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  address: z.string().trim().min(1).max(500),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accessInstructions: z.string().max(2000).optional(),
  observations: z.string().max(4000).optional(),
});
export const siteListQuerySchema = z.object({
  cliente: z.preprocess((value) => (value === '' ? undefined : value), z.string().optional()),
  estado: z.preprocess(
    (value) => (value === '' ? undefined : value),
    recordStatusSchema.optional(),
  ),
});
export const supervisorAssignmentSchema = z.object({
  supervisorIds: z
    .array(z.string().min(1))
    .refine((ids) => new Set(ids).size === ids.length, 'No se permiten supervisores duplicados'),
});
export const clientsResponseSchema = z.array(
  z.looseObject({
    id: z.string(),
    name: z.string(),
    contactName: z.string(),
    phone: z.string(),
    email: z.string(),
    taxId: z.string().nullable(),
    status: recordStatusSchema,
  }),
);
export const siteResponseSchema = z.looseObject({
  id: z.string(),
  clientId: z.string(),
  name: z.string(),
  address: z.string(),
  latitude: z.union([z.number(), z.string()]),
  longitude: z.union([z.number(), z.string()]),
  status: recordStatusSchema,
  accessInstructions: z.string().nullable().optional(),
  observations: z.string().nullable().optional(),
  supervisors: z.array(z.looseObject({ user: z.looseObject({ id: z.string() }) })).optional(),
  hasActiveSupervisor: z.boolean().optional(),
  maxSpeedProfile: speedProfileSchema.optional(),
  maxSpeedKmh: z.number().optional(),
  _count: z.looseObject({ sites: z.number() }).optional(),
});
export const sitesResponseSchema = z.array(siteResponseSchema);
export const clientResponseSchema = z.looseObject({
  id: z.string(),
  name: z.string(),
  contactName: z.string(),
  phone: z.string(),
  email: z.string(),
  taxId: z.string().nullable(),
  status: recordStatusSchema,
  sites: sitesResponseSchema,
});
export type ClientInput = z.infer<typeof clientInputSchema>;
export type SiteInput = z.infer<typeof siteInputSchema>;
