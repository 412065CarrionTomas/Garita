import { authMeResponseSchema } from './auth';

const validProfile = {
  id: 'user-1',
  firstName: 'Ana',
  lastName: 'Guardia',
  email: 'ana@example.com',
  role: 'guard',
  status: 'active',
  company: { id: 'company-1', name: 'Seguridad Norte' },
  allowedChannels: ['mobile'],
};

describe('authMeResponseSchema', () => {
  it('acepta perfiles conformes para cada rol', () => {
    const profiles = [
      { ...validProfile, role: 'admin', allowedChannels: ['web', 'mobile'] },
      { ...validProfile, role: 'supervisor', allowedChannels: ['web', 'mobile'] },
      validProfile,
      { ...validProfile, role: 'client', allowedChannels: ['web'] },
    ];

    for (const profile of profiles)
      expect(authMeResponseSchema.safeParse(profile).success).toBe(true);
  });

  it.each([
    [{ ...validProfile, email: 'not-an-email' }],
    [{ ...validProfile, role: 'owner' }],
    [{ ...validProfile, status: 'pending' }],
    [{ ...validProfile, allowedChannels: ['desktop'] }],
    [{ ...validProfile, company: { id: 'company-1' } }],
  ])('rechaza perfiles malformados', (profile) => {
    expect(authMeResponseSchema.safeParse(profile).success).toBe(false);
  });
});
