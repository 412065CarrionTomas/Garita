import { notificationPreferencesSchema } from '@garita/shared';
import { NotificationPreferencesService } from './notification-preferences.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
it('sin registro está activada y solo escribe la identidad autenticada', async () => {
  const findFirst = jest.fn().mockResolvedValue(null),
    upsert = jest.fn().mockResolvedValue(undefined);
  const service = new NotificationPreferencesService({
    tenantPrisma: { notificationPreference: { findFirst, upsert } },
  } as unknown as PrismaService);
  const user: AuthenticatedUser = {
    userId: 'me',
    companyId: 'company',
    role: 'supervisor',
    status: 'active',
  };
  expect(await service.get(user)).toEqual({ shift_not_started: true });
  await service.put({ shift_not_started: false }, user);
  expect(upsert).toHaveBeenCalledWith({
    where: { userId_kind: { userId: 'me', kind: 'shift_not_started' } },
    create: { companyId: 'company', userId: 'me', kind: 'shift_not_started', push: false },
    update: { push: false },
  });
  expect(
    notificationPreferencesSchema.safeParse({ shift_not_started: true, shift_closed_early: false })
      .success,
  ).toBe(false);
});
