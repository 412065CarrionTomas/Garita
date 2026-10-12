import type { AuthMeResponse } from '@garita/shared';
import { homePathForRole } from './role-routes';

it.each([
  ['admin', '/resumen'],
  ['supervisor', '/turnos'],
  ['client', '/reportes'],
] as const)('elige la ruta inicial de %s', (role, path) => {
  expect(homePathForRole(role as AuthMeResponse['role'])).toBe(path);
});
