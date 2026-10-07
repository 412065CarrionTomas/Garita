import { z } from 'zod';

/** Roles de la plataforma. La API valida el rol en cada endpoint. */
export const USER_ROLES = ['admin', 'supervisor', 'guard', 'client'] as const;

export const userRoleSchema = z.enum(USER_ROLES);

export type UserRole = z.infer<typeof userRoleSchema>;

/** Nombres de los roles para mostrar en la interfaz. */
export const USER_ROLE_LABELS = {
  admin: 'Administrador',
  supervisor: 'Supervisor',
  guard: 'Vigilador',
  client: 'Cliente',
} as const satisfies Record<UserRole, string>;
