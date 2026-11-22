import { z } from 'zod';
import type { UserRole } from './roles';
import { guardSelectionSchema } from './subscriptions';

export const payOverdueRequestSchema = z
  .object({
    planId: z.string().min(1).optional(),
    guardSelection: guardSelectionSchema.optional(),
  })
  .strict()
  .refine((input) => !input.guardSelection || Boolean(input.planId), {
    message: 'La elección de vigiladores requiere un plan.',
  });
export type PayOverdueRequest = z.infer<typeof payOverdueRequestSchema>;

export const SUSPENSION_MESSAGES: Record<UserRole, string> = {
  admin: 'La cuenta está suspendida. Regularizá tu suscripción para continuar.',
  supervisor: 'La cuenta de tu empresa está suspendida. Contactá a tu administrador.',
  client: 'El servicio no está disponible temporalmente. Contactá a tu empresa de seguridad.',
  guard: 'La cuenta de tu empresa está suspendida. Consultá a tu supervisor.',
};

export const accountSuspendedResponseSchema = z.object({
  code: z.literal('ACCOUNT_SUSPENDED'),
  accountStatus: z.literal('suspended'),
  message: z.string(),
});
