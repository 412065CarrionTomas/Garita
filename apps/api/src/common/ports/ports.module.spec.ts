import { Test } from '@nestjs/testing';
import { NoopRealtime } from './realtime.port';
import type { RealtimePort } from './realtime.port';
import { SocketRealtimeService } from '../../modules/realtime/socket-realtime.service';
import { NotificationsService } from '../../modules/notifications/notifications.service';

describe('RealtimePort provider', () => {
  it('implements the typed realtime port without throwing before a gateway connects', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [SocketRealtimeService],
    }).compile();
    const realtime: RealtimePort = moduleRef.get(SocketRealtimeService);
    expect(() =>
      realtime.emitToSite('company', 'site', 'turno.actualizado', {
        shiftId: 'shift',
        siteId: 'site',
      }),
    ).not.toThrow();
    await moduleRef.close();
  });

  it('keeps the noop realtime implementation harmless', () => {
    expect(() => new NoopRealtime().emitToSite()).not.toThrow();
  });
});

describe('NotificationsPort provider', () => {
  it('encola una notificación del puerto sin bloquear el emisor', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const prisma = {
      systemPrisma: { user: { findMany: jest.fn().mockResolvedValue([{ id: 'u' }]) } },
    };
    const notifications = new NotificationsService(prisma as never, queue as never);
    await expect(
      notifications.notifyUsers({
        companyId: 'c',
        userIds: ['u'],
        kind: 'incident_new',
        payload: { kind: 'incident_new', link: '/incidentes/1' },
      }),
    ).resolves.toBeUndefined();
    expect(queue.add).toHaveBeenCalledTimes(1);
  });
});
