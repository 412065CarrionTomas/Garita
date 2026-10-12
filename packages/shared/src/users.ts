import { z } from 'zod';

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
  estado: personnelStatusSchema.optional(),
  pagina: z.coerce.number().int().positive().default(1),
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
});
export const invitationRedeemRequestSchema = z.object({ token: z.string().min(1).max(512) });
export const invitationRedeemResponseSchema = z.object({
  passwordSetupUrl: z.url(),
  role: personnelRoleSchema,
});
export const emptyResponseSchema = z.object({ ok: z.literal(true) });
export const emptyRequestSchema = z.object({}).strict();
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>;
export type UpdateUserRequest = z.infer<typeof updateUserRequestSchema>;
