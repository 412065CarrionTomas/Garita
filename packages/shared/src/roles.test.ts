import { USER_ROLE_LABELS, USER_ROLES, userRoleSchema } from './roles';

describe('userRoleSchema', () => {
  it.each(USER_ROLES)('acepta el rol %s', (role) => {
    expect(userRoleSchema.parse(role)).toBe(role);
  });

  it('rechaza un rol desconocido', () => {
    expect(userRoleSchema.safeParse('superadmin').success).toBe(false);
  });

  it('tiene una etiqueta para cada rol', () => {
    expect(Object.keys(USER_ROLE_LABELS).sort()).toEqual([...USER_ROLES].sort());
  });
});
