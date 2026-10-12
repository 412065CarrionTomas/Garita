import type { UserRole } from '@garita/shared';

const homeByRole: Record<UserRole, string> = {
  admin: '/resumen',
  supervisor: '/turnos',
  guard: '/mis-turnos',
  client: '/reportes',
};

export function homePathForRole(role: UserRole): string {
  return homeByRole[role];
}
