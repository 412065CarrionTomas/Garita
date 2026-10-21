import { NoopRealtime } from './realtime.port';
import { NotificationsService } from '../../modules/notifications/notifications.service';

describe('PortsModule', () => {
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
    expect(() => {
      new NoopRealtime().emitToSite();
    }).not.toThrow();
  });
});
