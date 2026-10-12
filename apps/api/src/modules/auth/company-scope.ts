import type { AuthenticatedUser } from './auth.types';

/** Fuerza el tenant autenticado al final; filtros del cliente nunca pueden reemplazarlo. */
export function companyScope<T extends object>(
  user: AuthenticatedUser,
  filters: T,
): T & { companyId: string } {
  return { ...filters, companyId: user.companyId };
}
