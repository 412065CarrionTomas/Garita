import { USER_ROLES } from '@garita/shared';
import { allowedChannelsForRole } from './auth.service';

describe('allowedChannelsForRole', () => {
  it.each([
    ['admin', ['web', 'mobile']],
    ['supervisor', ['web', 'mobile']],
    ['guard', ['mobile']],
    ['client', ['web']],
  ] as const)('%s recibe sus canales permitidos', (role, expected) => {
    expect(allowedChannelsForRole(role)).toEqual(expected);
  });

  it('incluye una expectativa para cada rol compartido', () => {
    expect(USER_ROLES).toEqual(['admin', 'supervisor', 'guard', 'client']);
    expect(USER_ROLES.map((role) => allowedChannelsForRole(role))).toHaveLength(USER_ROLES.length);
  });
});
