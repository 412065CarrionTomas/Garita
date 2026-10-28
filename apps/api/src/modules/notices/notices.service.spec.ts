import { Prisma } from '../../generated/prisma/client';
import { NoticesService } from './notices.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { TenantResourceService } from '../auth/tenant-resource.service';
import type { NotificationsPort } from '../../common/ports/notifications.port';
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
    const notifications = { notifySiteStaff } as unknown as NotificationsPort;
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
