import { z } from 'zod';
import { LEGAL_VERSION } from './legal';
import { pageNumberSchema, pageSizeSchema } from './pagination';

export const personnelRoleSchema = z.enum(['supervisor', 'guard']);
export const personnelStatusSchema = z.enum(['invitation_pending', 'active', 'deactivated']);
export const createUserRequestSchema = z.object({
  firstName: z.string().trim().min(2).max(60),
  lastName: z.string().trim().min(2).max(60),
  email: z.email(),
  phone: z
    .string()
    .refine(
      (value) => /^\+[1-9][0-9 ]{7,18}$/.test(value) && value.replaceAll(' ', '').length <= 16,
      'Ingresá un teléfono celular internacional',
    ),
  role: personnelRoleSchema,
  employeeNumber: z.string().trim().max(40).optional(),
});
export const updateUserRequestSchema = createUserRequestSchema
  .pick({
    firstName: true,
    lastName: true,
    phone: true,
    employeeNumber: true,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0);
export const listUsersQuerySchema = z.object({
  rol: personnelRoleSchema.optional(),
  /** `invitation_failed` es un subconjunto de `invitation_pending`: el último envío falló. */
  estado: z.enum([...personnelStatusSchema.options, 'invitation_failed']).optional(),
  buscar: z.string().trim().max(100).optional(),
  orden: z.enum(['recientes', 'nombre', 'estado']).default('recientes'),
  pagina: pageNumberSchema,
  porPagina: pageSizeSchema,
});
export const personnelUserSchema = z.object({
  id: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  email: z.email(),
  phone: z.string().nullable(),
  employeeNumber: z.string().nullable(),
  role: personnelRoleSchema,
  status: personnelStatusSchema,
  invitationStatus: z.enum(['pending', 'sent', 'failed']).nullable(),
});
export const usersPageSchema = z.object({
  items: z.array(personnelUserSchema),
  pagina: z.number(),
  total: z.number(),
  paginas: z.number(),
  /** Conteos por estado con los filtros de rol y búsqueda, sin el de estado. */
  resumen: z.object({
    active: z.number(),
    invitation_pending: z.number(),
    invitation_failed: z.number(),
    deactivated: z.number(),
  }),
});
export const invitationRedeemRequestSchema = z.object({
  token: z.string().min(1).max(512),
  acceptedLegalVersion: z.literal(LEGAL_VERSION),
});
export const invitationRedeemResponseSchema = z.object({
  passwordSetupUrl: z.url(),
  role: z.enum(['supervisor', 'guard', 'client']),
});
export const emptyResponseSchema = z.object({ ok: z.literal(true) });
export const emptyRequestSchema = z.object({}).strict();
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;

export const createClientUserRequestSchema = createUserRequestSchema
  .pick({ firstName: true, lastName: true, email: true })
  .extend({ position: z.string().trim().max(80).optional() })
  .strict();
export const clientUserSchema = personnelUserSchema.extend({
  role: z.literal('client'),
  clientId: z.string(),
  position: z.string().nullable(),
  lastLoginAt: z.iso.datetime().nullable(),
});
export const clientUsersSchema = z.array(clientUserSchema);
export type CreateClientUserRequest = z.infer<typeof createClientUserRequestSchema>;
