import { Prisma } from '../../generated/prisma/client';
import { NoticesService } from './notices.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { RealtimePort } from '../../common/ports/realtime.port';

describe('NoticesService', () => {
  it('raises a key once and delivers only the created notice', async () => {
    const duplicate = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '7.0.0',
    });
    const create = jest
      .fn()
      .mockResolvedValueOnce({
        id: 'notice-1',
        kind: 'round_missed',
        siteId: 'site-1',
        shiftId: 'shift-1',
      })
      .mockRejectedValueOnce(duplicate);
    const prisma = {
      systemPrisma: {
        notice: { create },
        site: { findUnique: jest.fn().mockResolvedValue({ name: 'Predio A' }) },
      },
    } as unknown as PrismaService;
    const notifySiteStaff = jest.fn().mockResolvedValue(undefined);
    const emitToSite = jest.fn();
    const notifications = { notifySiteStaff, notifyUsers: jest.fn().mockResolvedValue(undefined) };
    const realtime = { emitToSite } as unknown as RealtimePort;
    const service = new NoticesService(
      prisma,
      {} as TenantResourceService,
      notifications,
      realtime,
    );
    const input = {
      companyId: 'company-1',
      siteId: 'site-1',
      shiftId: 'shift-1',
      kind: 'round_missed' as const,
      subjectId: 'window-1',
    };
    await service.raise(input);
    await service.raise(input);
    expect(create).toHaveBeenCalledTimes(2);
    expect(notifySiteStaff).toHaveBeenCalledTimes(1);
    expect(emitToSite).toHaveBeenCalledTimes(1);
  });
});

describe('HU-35 preferencias de push', () => {
  it.each(['shift_not_started', 'shift_closed_early', 'shift_without_guard'] as const)(
    '%s se crea igual y solo el mutable excluye a la supervisora',
    async (kind) => {
      const create = jest
        .fn<Promise<unknown>, [unknown]>()
        .mockResolvedValue({ id: 'notice', kind, siteId: 'site', shiftId: 'shift' });
      const findMany = jest.fn().mockResolvedValue([{ userId: 'muted-supervisor' }]);
      const notifySiteStaff = jest.fn().mockResolvedValue(undefined);
      const prisma = {
        systemPrisma: {
          notice: { create },
          notificationPreference: { findMany },
          site: { findUnique: jest.fn().mockResolvedValue({ name: 'Predio' }) },
        },
      } as unknown as PrismaService;
      const service = new NoticesService(
        prisma,
        {} as TenantResourceService,
        { notifySiteStaff, notifyUsers: jest.fn().mockResolvedValue(undefined) },
        { emitToSite: jest.fn() },
      );
      await service.raise({
        companyId: 'company',
        siteId: 'site',
        shiftId: 'shift',
        subjectId: 'subject',
        kind,
        pushBody: 'Cerrado a las 14:00, recibido a las 17:20',
      });
      expect(create).toHaveBeenCalledTimes(1);
      const creation = create.mock.calls[0]?.[0];
      expect(creation).toHaveProperty('data');
      expect(creation).not.toHaveProperty('data.pushBody');
      expect(notifySiteStaff).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeUserIds: kind === 'shift_not_started' ? ['muted-supervisor'] : [],
          payload: expect.objectContaining({
            body: 'Cerrado a las 14:00, recibido a las 17:20',
          }) as unknown,
        }),
      );
      if (kind === 'shift_not_started')
        expect(findMany).toHaveBeenCalledWith({
          where: { companyId: 'company', kind, push: false },
          select: { userId: true },
        });
      else expect(findMany).not.toHaveBeenCalled();
    },
  );
});
